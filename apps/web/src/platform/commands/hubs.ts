import { rawFetch, hubFetch, HubApiError } from "../http";
import {
  getSession,
  setSession,
  removeSession,
  allSessions,
  getActiveHubId,
  setActiveHubId,
  type HubSession,
} from "../session";
import { HubWebSocket, type WsHandlers } from "../ws";
import {
  loadSavedHubs,
  upsertSavedHub,
  removeSavedHub,
  updateSavedHub,
  updateSavedHubUrl,
  saveHubCapabilities,
  saveActiveHubId,
  saveToken,
  clearToken,
  type SavedHub,
} from "../storage";
import { loadIdentity, saveIdentity } from "../../identity/store";
import { publicKeyHex } from "@wavvon/core";
import type { Hub } from "@shared/types";
import { probeSessionScope } from "./lobby";
import { acquireHubToken as authenticate } from "./hubAuth";
import { ensureHomeHubDesignation, ensureSelfDeviceCert } from "./identity";

interface InfoResponse {
  public_key: string;
  name: string;
  icon: string | null;
  /** What the hub can do. Absent on hubs older than capability advertising,
   * which reads correctly as "knows nothing". Gate features on this — never
   * on `version`. See platform/session.ts `hubSupports`. */
  capabilities?: string[];
  /** Display and "very old hub" warnings only. Not a feature gate. */
  version?: string;
  /** The address this hub says to use for it. Changes when a path-hosted hub
   * is renamed; the client follows it, keyed on the pubkey that doesn't. */
  canonical_url?: string | null;
  farm_url?: string | null;
  welcome_label?: string | null;
  welcome_invite_url?: string | null;
  /** SHA-256 hex of the LAN self-signed cert, present when lan_tls === "self". */
  lan_fingerprint?: string | null;
}

/** Where this identity's `/auth/*` calls go.
 *
 * A farm-managed hub tells clients to authenticate at the farm
 * (`/info.farm_url`; the hub's health.rs says so in as many words), and for an
 * ordinary identity that is the point: one farm token works on every hub of
 * the farm.
 *
 * A **paired device is the exception.** Resolving a subkey to the identity it
 * actually speaks for happens in the *hub's* `/auth/verify` — off the cert the
 * client presents, or off the device the pairing flow registered with that hub
 * — and the farm has neither. Sending a paired device to the farm made it land
 * on every farm-hosted hub as a brand-new stranger, with no error anywhere:
 * the join succeeded and the device was simply somebody else. Authenticating
 * at the hub costs that one device farm SSO and is otherwise identical.
 */
function authBaseUrl(info: InfoResponse, hub_url: string, subkeyCert?: unknown): string {
  if (subkeyCert) return hub_url;
  return info.farm_url ?? hub_url;
}


export async function addHub(
  hub_url: string,
  handlers: WsHandlers,
  opts?: { invite_code?: string; rememberMe?: boolean; sessionToken?: string },
): Promise<Hub> {
  const url = hub_url.replace(/\/$/, "");

  const info: InfoResponse = await rawFetch(`${url}/info`).then(
    (r) => r.json() as Promise<InfoResponse>,
  );

  let token: string;
  // "member" is the safe default for the sessionToken (webauthn) path below,
  // where we don't get a scope back directly — a wrong "member" guess just
  // means the WS handshake gets rejected once and self-corrects via
  // onReauthNeeded, which re-authenticates through the full identity flow
  // and does learn the real scope.
  let scope: "member" | "lobby" = "member";
  if (opts?.sessionToken) {
    token = opts.sessionToken;
    scope = await probeSessionScope(url, token);
  } else {
    const identity = await loadIdentity();
    if (!identity) throw new Error("No identity — generate one first");

    const res = await authenticate(
      authBaseUrl(info, url, identity.subkey_cert),
      publicKeyHex(identity.seed_hex),
      identity.seed_hex,
      identity.security_nonce,
      identity.security_level,
      opts?.invite_code,
      identity.subkey_cert,
    );
    token = res.token;
    scope = res.scope;

    // Paired device: persist the canonical identity the hub attributes our
    // actions to, so the UI self-identifies as the shared user rather than
    // this device's own subkey pubkey.
    if (
      identity.subkey_cert &&
      res.canonicalPubkey &&
      res.canonicalPubkey !== publicKeyHex(identity.seed_hex) &&
      identity.canonical_pubkey !== res.canonicalPubkey
    ) {
      await saveIdentity({ ...identity, canonical_pubkey: res.canonicalPubkey });
    }
  }

  const rememberMe = opts?.rememberMe ?? false;
  saveToken(info.public_key, token, rememberMe);

  // A lobby-scoped token is rejected by the hub's WS handshake (no
  // channels/voice/presence in the lobby) — opening it here would just spin
  // the reconnect/reauth loop. The socket is opened later by
  // connectHubWebSocket() once /lobby/submit-pow reports promotion.
  const ws = scope === "lobby" ? null : new HubWebSocket(url, token, info.public_key, handlers);

  const session: HubSession = {
    hub_id: info.public_key,
    hub_url: url,
    hub_pubkey: info.public_key,
    hub_name: info.name,
    hub_icon: info.icon,
    token,
    ws,
    scope,
    capabilities: info.capabilities ?? [],
    hub_version: info.version,
  };
  setSession(info.public_key, session);

  // Read before upsertSavedHub below: "does this identity already know a hub"
  // is the question, and a moment later this hub is one of them.
  const isFirstHub = !loadSavedHubs().some((h) => h.hub_id !== info.public_key);

  if (!getActiveHubId()) {
    setActiveHubId(info.public_key);
    saveActiveHubId(info.public_key);
  }

  const saved: SavedHub = {
    hub_id: info.public_key,
    hub_name: info.name,
    hub_url: url,
    hub_icon: info.icon,
    remember_token: rememberMe,
    capabilities: info.capabilities ?? [],
    hub_version: info.version,
  };
  upsertSavedHub(saved);

  const isActive = getActiveHubId() === info.public_key;

  // Only for the hub that ends up active: hubFetch inside targets the active
  // hub, so these read from — and publish to — this very hub. Fire and forget;
  // a hub too old to serve either must not fail a join, and Settings can always
  // publish both by hand.
  //
  // The cert goes first: it is what lets this hub (and every hub it federates
  // to) resolve our roster pubkey to the master the designation is stored
  // under, so publishing the designation before the link exists would leave a
  // list nobody can look up.
  if (isActive && scope !== "lobby") {
    void loadIdentity()
      .then(async (id) => {
        if (!id) return;
        await ensureSelfDeviceCert(id, url).catch(() => {});
        if (isFirstHub) await ensureHomeHubDesignation(id, url);
      })
      .catch(() => {});
  }

  return {
    hub_id: info.public_key,
    hub_name: info.name,
    hub_url: url,
    hub_icon: info.icon,
    is_active: isActive,
  };
}

/** Apply an invite to the hub this session is already on. The client has only
 *  ever handled invites by re-authenticating with the code, which is the
 *  registration path — for someone already a member the hub has a separate
 *  route that auto-approves and applies the invite's role grant
 *  (`routes/invites.rs::join_with_invite`). Answers with a bare status. */
export async function redeemInvite(code: string): Promise<void> {
  await hubFetch(`/join/${encodeURIComponent(code)}`, { method: "POST" });
}

export function listHubs(): Hub[] {
  return allSessions().map((s) => ({
    hub_id: s.hub_id,
    hub_name: s.hub_name,
    hub_url: s.hub_url,
    hub_icon: s.hub_icon,
    is_active: s.hub_id === getActiveHubId(),
  }));
}

// Chokepoint for syncing a hub's name+icon+capabilities from its /info into
// both the live session and the localStorage SavedHub — used by the
// post-admin-save sync, the hub_updated WS handler, and the loadHubData
// self-heal, so none of them re-implement the fetch. Returns the fetched info
// (incl. timezone, read by loadHubData) or null if the hub has no session or
// the fetch failed.
//
// Capabilities ride along here rather than in their own fetch: this already
// runs on connect and on every hub_updated, which is exactly when what a hub
// can do could have changed (it was restarted onto a new version).
export async function refreshHubInfo(
  hub_id: string,
): Promise<{
  name: string;
  icon: string | null;
  timezone: string | null;
  capabilities: string[];
  version: string | null;
} | null> {
  const s = getSession(hub_id);
  if (!s) return null;
  try {
    const info = await rawFetch(`${s.hub_url}/info`).then(
      (r) => r.json() as Promise<InfoResponse & { timezone?: string | null }>,
    );
    const capabilities = info.capabilities ?? [];

    // Follow the hub if it has moved. A path-hosted hub lives at an
    // owner-chosen name that can change, and `canonical_url` is how it tells
    // us the current one — so a rename costs nobody their session.
    //
    // Safe precisely because we are keyed on the pubkey: we only change *where*
    // we look, never who we believe we are talking to. And we only accept this
    // from a hub whose key we have already verified, so a host handing out a
    // bogus address gets caught on the first /info at the new one.
    const movedTo =
      info.canonical_url && info.canonical_url !== s.hub_url ? info.canonical_url : null;
    if (movedTo) {
      console.info(`[hubs] ${hub_id.slice(0, 8)} moved to ${movedTo}`);
      updateSavedHubUrl(hub_id, movedTo);
    }

    setSession(hub_id, {
      ...s,
      hub_url: movedTo ?? s.hub_url,
      hub_name: info.name,
      hub_icon: info.icon,
      capabilities,
      hub_version: info.version,
    });
    updateSavedHub(hub_id, info.name, info.icon);
    saveHubCapabilities(hub_id, capabilities, info.version);
    return {
      name: info.name,
      icon: info.icon,
      timezone: info.timezone ?? null,
      capabilities,
      version: info.version ?? null,
    };
  } catch {
    return null;
  }
}

export function setActiveHub(hub_id: string): void {
  if (!getSession(hub_id)) throw new Error("Hub not connected");
  setActiveHubId(hub_id);
  saveActiveHubId(hub_id);
}

export async function removeHub(hub_id: string): Promise<void> {
  const s = getSession(hub_id);
  s?.ws?.close();
  removeSession(hub_id);
  removeSavedHub(hub_id);
  clearToken(hub_id);

  if (getActiveHubId() === hub_id) {
    const remaining = allSessions();
    const next = remaining[0]?.hub_id ?? null;
    setActiveHubId(next);
    saveActiveHubId(next);
  }
}

export async function pingHub(hub_id: string): Promise<number> {
  const s = getSession(hub_id);
  if (!s) throw new Error("Hub not connected");
  const start = Date.now();
  await rawFetch(`${s.hub_url}/health`);
  return Date.now() - start;
}

// Re-authenticate the active hub presenting the stored subkey cert, refreshing
// the session token in place (the existing WebSocket stays valid). Called right
// after enabling multi-device so the hub records the master on this user's row
// immediately — a prerequisite for a newly paired device to resolve to the same
// canonical identity. No-op if the identity has no cert or no active hub.
export async function upgradeActiveHubIdentity(): Promise<void> {
  const identity = await loadIdentity();
  if (!identity?.subkey_cert) return;
  const hub_id = getActiveHubId();
  if (!hub_id) return;
  const s = getSession(hub_id);
  if (!s) return;

  const info: InfoResponse = await rawFetch(`${s.hub_url}/info`).then(
    (r) => r.json() as Promise<InfoResponse>,
  );
  const res = await authenticate(
    authBaseUrl(info, s.hub_url, identity.subkey_cert),
    publicKeyHex(identity.seed_hex),
    identity.seed_hex,
    identity.security_nonce,
    identity.security_level,
    undefined,
    identity.subkey_cert,
  );
  saveToken(hub_id, res.token, true);
  setSession(hub_id, { ...s, token: res.token });
  if (
    res.canonicalPubkey &&
    res.canonicalPubkey !== publicKeyHex(identity.seed_hex) &&
    identity.canonical_pubkey !== res.canonicalPubkey
  ) {
    await saveIdentity({ ...identity, canonical_pubkey: res.canonicalPubkey });
  }
}

export async function reauthorizeHub(
  hub_id: string,
  handlers: WsHandlers,
): Promise<void> {
  const s = getSession(hub_id);
  if (!s) throw new Error("Hub not connected");

  const info: InfoResponse = await rawFetch(`${s.hub_url}/info`).then(
    (r) => r.json() as Promise<InfoResponse>,
  );

  const identity = await loadIdentity();
  if (!identity) throw new Error("No identity");

  const seedHex = identity.seed_hex;
  const pubkeyHex = publicKeyHex(seedHex);
  const { token, scope } = await authenticate(
    authBaseUrl(info, s.hub_url, identity.subkey_cert),
    pubkeyHex,
    seedHex,
    identity.security_nonce,
    identity.security_level,
    undefined,
    identity.subkey_cert,
  );

  s.ws?.close();
  // A fresh handshake landing back in "lobby" (e.g. the previous session
  // was wrongly assumed "member" via the sessionToken path in addHub, or
  // min_security_level was raised after the original join) must not reopen
  // the WS — that's exactly the reconnect storm this scope check prevents.
  const ws = scope === "lobby" ? null : new HubWebSocket(s.hub_url, token, hub_id, handlers);
  setSession(hub_id, { ...s, token, ws, scope });
}

// Opens the hub's WebSocket for a session that was deliberately left
// disconnected because it was lobby-scoped (see addHub/reauthorizeHub).
// Called once /lobby/submit-pow reports promotion — the same token that was
// rejected moments ago is now valid for the WS, no re-auth needed.
export function connectHubWebSocket(hub_id: string, handlers: WsHandlers): void {
  const s = getSession(hub_id);
  if (!s || s.ws) return;
  const ws = new HubWebSocket(s.hub_url, s.token, hub_id, handlers);
  setSession(hub_id, { ...s, ws, scope: "member" });
}

// LAN fingerprint pinning (lan-mode.md §5): TOFU-verify the hub's
// self-reported /info fingerprint against the one carried out-of-band in
// the invite URL. `undefined` expectedFingerprint means the invite carried
// none — always passes, so normal (non-LAN) hubs are unaffected. Shared by
// every add-hub call site (App.tsx, WelcomeScreenContainer) so none of them
// can silently skip the check.
export async function verifyLanFingerprint(
  hub_url: string,
  expectedFingerprint: string | undefined,
): Promise<boolean> {
  if (!expectedFingerprint) return true;
  const info = await previewHubInfo(hub_url);
  return (info.lan_fingerprint ?? "").toLowerCase() === expectedFingerprint;
}

export async function previewHubInfo(hub_url: string): Promise<{
  name: string;
  public_key: string;
  icon: string | null;
  welcome_label: string | null;
  welcome_invite_url: string | null;
  lan_fingerprint: string | null;
}> {
  const url = hub_url.replace(/\/$/, "");
  const info: InfoResponse = await rawFetch(`${url}/info`).then((r) => r.json() as Promise<InfoResponse>);
  return {
    name: info.name,
    public_key: info.public_key,
    icon: info.icon,
    welcome_label: info.welcome_label ?? null,
    welcome_invite_url: info.welcome_invite_url ?? null,
    lan_fingerprint: info.lan_fingerprint ?? null,
  };
}

export async function reorderHubs(hub_ids: string[]): Promise<void> {
  const { loadSavedHubs, saveSavedHubs } = await import("../storage");
  const saved = loadSavedHubs();
  const ordered = hub_ids
    .map((id) => saved.find((h) => h.hub_id === id))
    .filter(Boolean) as typeof saved;
  saveSavedHubs(ordered);
}

// Reconnect to persisted hubs from localStorage on app load.
// A 429 or a 5xx says "not now"; every other failure says something about
// this hub. The distinction matters because the restore loop's fallback is to
// drop the hub, and a dropped hub with no session is a user staring at the
// welcome screen wondering where their communities went.
function isTransient(e: unknown): boolean {
  return e instanceof HubApiError && (e.status === 429 || e.status >= 500);
}

// Startup re-auth is not an edge case: the web client keeps its token in
// sessionStorage unless asked to remember it, so every page load authenticates
// again, and the hub's auth limiter is per-IP — shared with every other person
// behind the same address, and with every tab this one has open. Meeting a 429
// there is ordinary. The delays are short because the limiter refills
// continuously (hub rate_limit.rs: 1/s); this is waiting for a token, not
// backing off from an outage.
const RESTORE_RETRY_DELAYS_MS = [1000, 2000];

async function authenticateForRestore(
  ...args: Parameters<typeof authenticate>
): Promise<Awaited<ReturnType<typeof authenticate>>> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await authenticate(...args);
    } catch (e) {
      if (attempt >= RESTORE_RETRY_DELAYS_MS.length || !isTransient(e)) throw e;
      await new Promise((r) => setTimeout(r, RESTORE_RETRY_DELAYS_MS[attempt]));
    }
  }
}

export async function restorePersistedHubs(handlers: WsHandlers): Promise<Hub[]> {
  const { loadSavedHubs, loadToken, loadActiveHubId } = await import("../storage");
  const saved = loadSavedHubs();
  const result: Hub[] = [];

  const identity = await loadIdentity();
  if (!identity) return [];

  const seedHex = identity.seed_hex;
  const pubkeyHex = publicKeyHex(seedHex);
  const savedActiveId = loadActiveHubId();

  for (const hub of saved) {
    try {
      let token = loadToken(hub.hub_id);
      // Cached tokens don't carry a scope, so it has to be re-probed on
      // every restore — a stale "member" assumption for a cached lobby
      // token would open a WS the hub immediately rejects.
      let scope: "member" | "lobby" = "member";
      if (!token) {
        const hubInfo: InfoResponse = await rawFetch(`${hub.hub_url}/info`).then(
          (r) => r.json() as Promise<InfoResponse>,
        );
        const authRes = await authenticateForRestore(
          authBaseUrl(hubInfo, hub.hub_url, identity.subkey_cert),
          pubkeyHex,
          seedHex,
          identity.security_nonce,
          identity.security_level,
          undefined,
          identity.subkey_cert,
        );
        token = authRes.token;
        scope = authRes.scope;
        if (
          identity.subkey_cert &&
          authRes.canonicalPubkey &&
          authRes.canonicalPubkey !== pubkeyHex &&
          identity.canonical_pubkey !== authRes.canonicalPubkey
        ) {
          await saveIdentity({ ...identity, canonical_pubkey: authRes.canonicalPubkey });
        }
        saveToken(hub.hub_id, token, hub.remember_token);
      } else {
        scope = await probeSessionScope(hub.hub_url, token);
      }

      const ws = scope === "lobby" ? null : new HubWebSocket(hub.hub_url, token, hub.hub_id, handlers);
      setSession(hub.hub_id, {
        hub_id: hub.hub_id,
        hub_url: hub.hub_url,
        hub_pubkey: hub.hub_id,
        hub_name: hub.hub_name,
        hub_icon: hub.hub_icon,
        token,
        ws,
        scope,
        // Last known, from localStorage — this path deliberately skips /info
        // when a cached token makes it unnecessary, so seeding from the saved
        // list is the only way the UI is right before loadHubData's
        // refreshHubInfo lands. `undefined` (hub saved by an older build)
        // stays undefined so hubSupports() falls through to the saved record
        // rather than caching an empty list as fact.
        capabilities: hub.capabilities,
        hub_version: hub.hub_version,
      });

      result.push({
        hub_id: hub.hub_id,
        hub_name: hub.hub_name,
        hub_url: hub.hub_url,
        hub_icon: hub.hub_icon,
        is_active: hub.hub_id === savedActiveId,
      });
    } catch (e) {
      // Skip a hub we cannot reach on startup -- but say which, and why. A
      // silent drop here is indistinguishable from never having joined it,
      // and it is the only thing the user is shown: no session, no hub in the
      // list, and if it was the only one, the welcome screen back.
      console.warn(`[restore] skipping ${hub.hub_url}:`, e);
    }
  }

  if (savedActiveId && getSession(savedActiveId)) {
    setActiveHubId(savedActiveId);
  } else if (result.length > 0) {
    setActiveHubId(result[0].hub_id);
  }

  return result;
}

/** Leave a hub for real: the hub clears this identity's profile and roles
 *  (`DELETE /me`), then the client forgets it locally like any removal.
 *
 *  Distinct from `removeHub`, which only forgets. Gated on the `hub.leave`
 *  capability at the call site — a hub without it answers 404, and offering
 *  the action there would leave someone believing they left.
 *
 *  Ordering matters on failure: the hub goes first, and a rejection (the owner
 *  gets 409) leaves the client untouched, so a refused leave is not silently
 *  half-done. */
export async function leaveHub(hub_id: string): Promise<void> {
  const s = getSession(hub_id);
  if (!s) throw new Error("Hub not connected");
  const res = await rawFetch(`${s.hub_url}/me`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${s.token}` },
  });
  if (!res.ok) throw new Error(await res.text());
  await removeHub(hub_id);
}
