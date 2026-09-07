import { hexToBytes, bytesToHex } from "@wavvon/core";
import { dmFetch, dmSession } from "../dmHub";
import { fetchAllPages, LIST_CURSOR_CAP, LIST_MAX_PAGES, LIST_PAGE_SIZE } from "./paged";
import { hubFetch, rawFetch, HubApiError } from "../http";
import { activeSession } from "../session";
import i18n from "@wavvon/i18n";
import { loadIdentity } from "../../identity/store";
import type { IdentityRecord } from "../../identity/store";
import { getScoped, setScoped } from "../../utils/accountScope";
import {
  dhKeypairFromSeed,
  encryptDm,
  decryptDm,
  encryptDmDr,
  decryptDmDr,
  initDrSession,
  signBytes,
  publicKeyHex,
  dhKeySigningBytes,
  verifyDmEnvelopeSigner,
  type DmEnvelope,
  type DRSession,
  type DrEnvelope,
  type SubkeyCert,
} from "@wavvon/core";
import type { Conversation, DmMessage, DmMessageFull, Attachment } from "@shared/types";

// ---------------------------------------------------------------------------
// Cert-chained DM attribution (decisions.md "Paired-device DMs attribute to
// canonical via cert-chained envelopes; DH capability is a wrapped canonical
// scalar"). Pulled out as a pure function of the identity record so the
// paired-vs-unpaired decision is unit-testable without a network mock.
// ---------------------------------------------------------------------------

export interface DmSendAttribution {
  /** The seed this device actually signs with — always its own. */
  signingSeedHex: string;
  /** Always the canonical identity — what the envelope's sender_pubkey carries. */
  senderPubkey: string;
  /** Attached only when this device's signing key differs from the canonical
   *  identity (a paired device signing with its own subkey). */
  signerCert?: SubkeyCert;
  /** The DH scalar to use for key agreement: the unwrapped canonical scalar
   *  for a paired device, or derived from this device's own seed otherwise. */
  dhPriv: Uint8Array;
}

export function resolveDmSendAttribution(
  identity: Pick<IdentityRecord, "seed_hex" | "canonical_pubkey" | "subkey_cert" | "canonical_dh_priv_hex">,
): DmSendAttribution {
  const signingSeedHex = identity.seed_hex;
  const senderPubkey = identity.canonical_pubkey ?? publicKeyHex(signingSeedHex);
  const dhPriv = identity.canonical_dh_priv_hex
    ? hexToBytes(identity.canonical_dh_priv_hex)
    : dhKeypairFromSeed(signingSeedHex).dhPriv;
  return {
    signingSeedHex,
    senderPubkey,
    signerCert: identity.subkey_cert,
    dhPriv,
  };
}

/** Which message to show for an encrypted DM this device could not read.
 *
 *  A message *we* sent is not a failure: a ratchet cannot decrypt its own
 *  envelopes, so the only readable copy is the one the sending device stashed
 *  locally. Getting here with our own pubkey as sender means this device has
 *  no such copy — it was sent from another device, or this one's storage was
 *  cleared. Both are the same fact, and neither is breakage.
 *
 *  Saying "decryption failed" for that made a known design limit look like a
 *  bug every time someone paired a second device. Someone else's message that
 *  will not open *is* a failure and still says so — as does a message whose
 *  cert chain did not verify, which this is deliberately not consulted for.
 *
 *  Returns the key rather than the text so the decision is testable without a
 *  translator. */
export function unreadableDmKey(sender: string, mySenderPubkey: string | null): string {
  return mySenderPubkey && sender === mySenderPubkey
    ? "dm.own_message_other_device"
    : "dm.decryption_failed";
}

export async function listConversations(): Promise<Conversation[]> {
  // The DM hub, not the active one — this is the only list read against a hub
  // the user may not be looking at, so its capabilities come from the session
  // `dmFetch` routes to rather than from `activeHubCapabilities`.
  const caps = (await dmSession()).capabilities ?? null;
  return fetchAllPages<Conversation>({
    capabilities: caps,
    capability: LIST_CURSOR_CAP,
    pageSize: LIST_PAGE_SIZE,
    maxPages: LIST_MAX_PAGES,
    cursorOf: (c) => c.id,
    fetchPage: async (params) =>
      (await (
        await dmFetch(params ? `/conversations?${params}` : "/conversations")
      ).json()) as Conversation[],
    label: "listConversations",
  });
}

export async function createConversation(member_pubkeys: string[]): Promise<Conversation> {
  // Server contract (hub routes/dms/conversations.rs CreateConversationRequest)
  // names the field `members`.
  const res = await dmFetch("/conversations", {
    method: "POST",
    body: JSON.stringify({ members: member_pubkeys }),
  });
  return res.json() as Promise<Conversation>;
}

interface RawDmMessage {
  id: string;
  conversation_id: string;
  sender: string;
  sender_name: string | null;
  content: string | null;
  created_at: number;
  attachments?: Attachment[];
  is_encrypted?: boolean;
  encrypted_envelope?: DmEnvelope | DrEnvelope;
  group_encrypted_envelope?: unknown;
  delivery_failed?: boolean;
}

function loadDrSession(convId: string): DRSession | null {
  try {
    const raw = getScoped(`wavvon_dr_${convId}`);
    return raw ? (JSON.parse(raw) as DRSession) : null;
  } catch {
    return null;
  }
}

function saveDrSession(convId: string, session: DRSession): void {
  setScoped(`wavvon_dr_${convId}`, JSON.stringify(session));
}

function emptyDrSession(): DRSession {
  return {
    rk: "", cks: null, ckr: null,
    ns: 0, nr: 0, pn: 0,
    dhsPriv: "", dhsPub: "", dhr: null,
    mkskipped: {},
  };
}

// A ratchet can't decrypt its own outbound envelopes (the message keys are
// consumed at encrypt time and the receiving chain belongs to the peer), so
// the sender's plaintext is stashed locally at send time and read back when
// rendering history. Desktop keeps DM history in its per-account local
// store; this is web's minimal equivalent.
// ponytail: one localStorage key per sent encrypted DM, never pruned —
// move into a bounded per-conversation blob if it ever matters.
function saveOwnPlaintext(messageId: string, content: string): void {
  try { setScoped(`wavvon_dm_own_${messageId}`, content); } catch {}
}

function loadOwnPlaintext(messageId: string): string | null {
  return getScoped(`wavvon_dm_own_${messageId}`);
}

export async function getDmMessages(
  conversation_id: string,
  before?: string,
  limit = 50,
): Promise<DmMessageFull[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before) params.set("before", before);
  const res = await dmFetch(`/conversations/${conversation_id}/messages?${params}`);
  const raw = (await res.json()) as RawDmMessage[];

  const identity = await loadIdentity();
  const identitySeed = identity?.seed_hex ?? null;
  const attribution = identity ? resolveDmSendAttribution(identity) : null;
  const dhPriv = attribution?.dhPriv ?? null;
  const mySenderPubkey = attribution?.senderPubkey ?? null;

  const unreadable = (sender: string) => i18n.t(unreadableDmKey(sender, mySenderPubkey));

  const results: DmMessageFull[] = [];
  for (const m of raw) {
    let content = m.content ?? "";
    const ownPlaintext = m.is_encrypted ? loadOwnPlaintext(m.id) : null;
    if (ownPlaintext !== null) {
      content = ownPlaintext;
    } else if (m.is_encrypted && m.encrypted_envelope) {
      const env = m.encrypted_envelope;
      // Cert-chained attribution (decisions.md "Paired-device DMs attribute
      // to canonical via cert-chained envelopes"): no signer_cert is
      // trusted as-is (today's behavior); a signer_cert must verify its
      // two-link chain AND bind sender_pubkey to the conversation's
      // canonical member (m.sender, already resolved server-side) before
      // the envelope is used for key selection.
      const envelopeTrusted =
        !env.signer_cert || (verifyDmEnvelopeSigner(env) && env.sender_pubkey === m.sender);

      if (!envelopeTrusted) {
        // Not `unreadable()`: this is a cert chain that did not verify, which
        // is a trust failure and stays one even when the envelope claims our
        // own canonical identity as sender. Softening it to "sent from
        // another device" would be the reassuring way to hide exactly the
        // case worth noticing.
        content = i18n.t("dm.decryption_failed");
      } else if ((env as DrEnvelope).v === 2 && identitySeed) {
        try {
          const senderDhPubHex = await fetchDhKey(m.sender) ?? "";
          const session = loadDrSession(m.conversation_id) ?? emptyDrSession();
          const { plaintext, updatedSession } = decryptDmDr(
            env as DrEnvelope,
            session,
            identitySeed,
            senderDhPubHex,
            dhPriv ?? undefined,
          );
          saveDrSession(m.conversation_id, updatedSession);
          content = plaintext;
        } catch {
          content = unreadable(m.sender);
        }
      } else if (dhPriv) {
        try {
          content = decryptDm(m.conversation_id, env as DmEnvelope, dhPriv);
        } catch {
          content = unreadable(m.sender);
        }
      }
    } else if (!m.content && m.group_encrypted_envelope) {
      content = "🔒 Encrypted message (upgrade client to read)";
    }
    results.push({
      id: m.id,
      conversation_id: m.conversation_id,
      sender: m.sender,
      sender_name: m.sender_name,
      content,
      created_at: m.created_at,
      attachments: m.attachments,
      is_encrypted: m.is_encrypted,
      delivery_failed: m.delivery_failed,
    });
  }
  return results;
}

export interface SendDmOptions {
  /** Asked before a message would leave unencrypted, and only then. Returning
   *  false abandons the send with the composer untouched.
   *
   *  Required in practice: without it this refuses rather than guessing, which
   *  is the one direction that cannot leak. Web used to take the other one —
   *  a recipient with no published key got a plaintext DM and no notice, and
   *  so did anyone whose key lookup merely failed. */
  confirmUnencrypted?: () => Promise<boolean>;
}

export type SendDmResult = "sent" | "cancelled";

export async function sendDm(
  conversation_id: string,
  content: string,
  attachments?: Attachment[],
  opts?: SendDmOptions,
): Promise<SendDmResult> {
  const identity = await loadIdentity();
  if (!identity) throw new Error("No identity");

  const { signingSeedHex, senderPubkey, signerCert, dhPriv } = resolveDmSendAttribution(identity);
  const conversation = await getConversation_(conversation_id);

  // Group DMs use sender keys, which this client does not implement — it says
  // so when *reading* one ("upgrade client to read"). Sending had no such
  // check, and the 1:1 path below would have picked whichever member happened
  // to come first and encrypted to them alone: readable by one person in the
  // group, undecryptable for everyone else, and reported to the sender as
  // sent. Reachable, because a desktop client can put a web user in a group.
  if (conversation.conv_type === "group") {
    throw new Error(i18n.t("dm.group_send_unsupported"));
  }

  const members = conversation.members;
  // Conversation membership is keyed to the canonical pubkey, not this
  // device's own signing key — a paired device's subkey never appears in
  // it (see decisions.md "Paired-device DMs attribute to canonical via
  // cert-chained envelopes").
  const recipientPubkey = members.find((m) => m !== senderPubkey);

  const sendPlaintext = async () => {
    await dmFetch(`/conversations/${conversation_id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, attachments }),
    });
  };

  // Nobody else in the conversation: there is no one to encrypt to, and
  // nothing to disclose to a third party either.
  if (!recipientPubkey) {
    await sendPlaintext();
    return "sent";
  }

  // Throws rather than answering null when the lookup itself failed — that
  // used to read as "no key" and send the message in the clear.
  const recipientDhPubHex = await lookupDhKey(recipientPubkey);
  if (!recipientDhPubHex) {
    // A real absence, and the user's call to make: the message would reach
    // their hub readable. No callback means no consent, and no consent means
    // no send.
    if (!opts?.confirmUnencrypted || !(await opts.confirmUnencrypted())) {
      return "cancelled";
    }
    await sendPlaintext();
    return "sent";
  }

  let drSession = loadDrSession(conversation_id);
  if (!drSession) {
    drSession = initDrSession(conversation_id, signingSeedHex, recipientDhPubHex, dhPriv);
  }
  const { envelope: drEnvelope, updatedSession } = encryptDmDr(
    conversation_id,
    content,
    drSession,
    signingSeedHex,
    senderPubkey,
    signerCert,
  );
  saveDrSession(conversation_id, updatedSession);

  const res = await dmFetch(`/conversations/${conversation_id}/messages`, {
    method: "POST",
    body: JSON.stringify({ encrypted_envelope: drEnvelope, attachments: attachments ?? [] }),
  });
  // Stash own plaintext for history rendering — a ratchet can't decrypt
  // its own outbound envelopes (see saveOwnPlaintext).
  try {
    const created = (await res.json()) as { id?: string };
    if (created.id) saveOwnPlaintext(created.id, content);
  } catch (e) {
    // The message is sent; only our own readable copy is missing, and the
    // symptom is this message reading "you sent this from another device"
    // in history. Worth a line rather than nothing.
    console.warn("[dm] sent, but could not stash our own plaintext copy:", e);
  }
  return "sent";
}

/** One conversation as the DM hub has it. Exported because the WS arm that
 *  reacts to membership changes needs the same hub the list came from. */
export async function getConversation(conversation_id: string): Promise<Conversation> {
  const res = await dmFetch(`/conversations/${conversation_id}`);
  return (await res.json()) as Conversation;
}

async function getConversation_(conversation_id: string): Promise<Conversation> {
  const res = await dmFetch(`/conversations/${conversation_id}`);
  return (await res.json()) as Conversation;
}

const dhKeyCache = new Map<string, { hex: string; ts: number }>();
const DH_CACHE_TTL = 24 * 60 * 60 * 1000;

/** Null means the hub answered and this identity has published no DH key.
 *  Anything else — a 429 off the shared limiter, a hub mid-restart, no
 *  network — throws, because the caller that matters treats null as "cannot
 *  encrypt" and a failed lookup is not that. */
export async function lookupDhKey(
  pubkey: string,
  hub_url?: string,
): Promise<string | null> {
  const cached = dhKeyCache.get(pubkey);
  if (cached && Date.now() - cached.ts < DH_CACHE_TTL) return cached.hex;

  const base = hub_url ?? activeSession().hub_url;
  let res: Response;
  try {
    res = await rawFetch(`${base}/identity/${pubkey}/dh-key`);
  } catch (e) {
    if (e instanceof HubApiError && e.status === 404) return null;
    throw e;
  }
  const record = (await res.json()) as {
    dh_pubkey_hex: string;
    signature_hex: string;
  };
  dhKeyCache.set(pubkey, { hex: record.dh_pubkey_hex, ts: Date.now() });
  return record.dh_pubkey_hex;
}

/** The lenient reading, for callers where a missing key means "skip this
 *  peer" and a failed lookup means the same thing in practice — voice key
 *  distribution drops a participant either way and retries on the next
 *  rekey. Never use it to decide whether to encrypt a message. */
export async function fetchDhKey(
  pubkey: string,
  hub_url?: string,
): Promise<string | null> {
  try {
    return await lookupDhKey(pubkey, hub_url);
  } catch {
    return null;
  }
}

/** Publish guard (decisions.md "DH capability via a wrapped canonical
 *  scalar"): only a device holding the canonical signing seed may publish —
 *  i.e. its own pubkey IS the canonical identity the hub attributes it to.
 *  A paired device (whose signing pubkey differs from canonical) must skip
 *  publish; the primary device already published the canonical DH key for
 *  this identity, and a paired device signing as itself would publish the
 *  wrong (non-canonical) DH key under the canonical pubkey's URL — it can't
 *  actually do so anyway (the hub verifies the record's signature against
 *  the canonical pubkey), but skipping client-side avoids a wasted round
 *  trip and a confusing rejection.
 */
export function canPublishDhKey(
  identity: Pick<IdentityRecord, "seed_hex" | "canonical_pubkey">,
): boolean {
  const myPubkeyHex = publicKeyHex(identity.seed_hex);
  return !identity.canonical_pubkey || identity.canonical_pubkey === myPubkeyHex;
}

export async function publishDhKey(): Promise<void> {
  const identity = await loadIdentity();
  if (!identity) throw new Error("No identity");
  if (!canPublishDhKey(identity)) return;

  const seedHex = identity.seed_hex;
  const myPubkeyHex = publicKeyHex(seedHex);
  const { dhPub } = dhKeypairFromSeed(seedHex);
  const dhPubkeyHex = bytesToHex(dhPub);

  const sigMsg = dhKeySigningBytes(myPubkeyHex, dhPubkeyHex);
  const signatureHex = signBytes(sigMsg, seedHex);

  // The active hub, deliberately, not the DM hub: a sender looks this key up
  // on *their own* hub, so it has to exist on every hub we actually use.
  // Publishing it only where our DMs are read would leave someone on a shared
  // community hub unable to encrypt to us.
  await hubFetch(`/identity/${myPubkeyHex}/dh-key`, {
    method: "PUT",
    body: JSON.stringify({ dh_pubkey_hex: dhPubkeyHex, signature_hex: signatureHex }),
  });
}
