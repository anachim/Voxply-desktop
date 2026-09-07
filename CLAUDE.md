# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

## What this repo is

The **Wavvon clients** — one pnpm + Cargo workspace holding the web client, the
desktop client, and everything they share. Wavvon is a self-hosted, federated
voice+text community platform. This repo is self-contained: you can clone, build
and run the clients from it alone (you need a hub to talk to — see below).

```
apps/web/           Vite + React 19. THE delivery target and source of truth.
apps/desktop/       Tauri 2 + React 19, multi-account. src-tauri/ is the Rust shell.
packages/ui/        ~110 shared components + the single canonical styles.css.
packages/core/      Platform-agnostic TS: wire types + signing, .wavvon-backup, crypto.
packages/i18n/      i18next catalogs (en/it/es/de).
crates/voice/       Rust audio pipeline used by the desktop shell.
```

Sibling repos (you don't need them checked out):

| Repo | Contents |
|---|---|
| [Wavvon-server](https://github.com/Wavvon/Wavvon-server) | Hub server, farm, the `identity` wire-format crate |
| [Wavvon-discovery](https://github.com/Wavvon/Wavvon-discovery) | Optional public hub directory site |
| [Wavvon-docs](https://github.com/Wavvon/Wavvon-docs) | Architecture wiki (70+ docs) + `openapi.yaml` |

**Read the wiki before grepping.** Start at
[docs/README.md](https://github.com/Wavvon/Wavvon-docs/blob/main/docs/README.md)
for the reading order. Wiki links below point at that repo; clone it alongside
this one if you want them offline.

Commit to **`develop`**. See `CONTRIBUTING.md`.

> A Tauri 2 Android client (`apps/android`) was removed 2026-07-12 — too far
> behind to maintain; slated for a clean-slate rewrite when mobile is
> prioritized. Build/native learnings are preserved in the wiki's
> `android-rewrite-notes.md`. Don't re-add Android without that being the
> explicit task.

---

## One codebase, two builds: the hub build and the user build

`apps/web` builds twice from the same source. The **user build** (`dist`) is
the multi-hub one, hosted next to the directory; the **hub build**
(`dist-hub`) is what a hub serves from its own origin, and it shows one hub
with no notion of a *list* of hubs. The hub build is the user build **minus**
entry points, which is why it is a flag and not a second app.

- `MULTI_HUB` in `apps/web/src/constants.ts`, from `VITE_BUILD_TARGET` via
  `.env.hub` and `--mode hub`. The comparison is a literal, so it folds and
  the dropped screens leave the bundle. Gate new multi-hub surface on it —
  and derive from it (`USER_CLIENT_URL`, `DISCOVERY_URL` already do) rather
  than re-reading the env var.
- Dropped in the hub build: the `+` menu, AddHubModal, the create-hub wizard,
  the directory, the home-hub editor. **Kept**: everything cross-hub that
  routes through the hub itself — alliance channels, messages, forum, *and*
  alliance voice, which dials the owning hub's relay directly. Defining the
  flag as "one origin only" breaks alliance voice.
- `scripts/check-hub-build.mjs` asserts three **code-only** markers are in
  `dist` and absent from `dist-hub`. i18n keys are useless as markers — the
  catalogs ship whole in both builds. Some marker classes carry no styling
  and exist only to be grepped (`home-hubs-section`); renaming one turns the
  check green and meaningless, and deleting a screen takes its marker with it
  — that is how the check went red once after the create-hub removal.

Both builds come from one commit, which is what makes "version-matched" true
by construction. Rationale: the docs wiki's `decisions.md`, "Two web clients:
one per hub, one per user".

## A client cannot create a hub, and knows nothing about farms

A hub exists because somebody ran the binary on their own server. There is no
flow in any client that makes one — no wizard, no bootstrap token, no "create"
entry beside "join". The `+` in the hub sidebar joins, and that is all it does.

**A farm is a server-side aggregate of hubs and is never a client concept.**
The farm admin panel, its settings page, quotas, creation policy and the
provisioning commands are all gone from web, desktop and the Tauri shell. Don't
add a farm noun back to this repo.

Two things survive that carry the word, and both are deliberate:

- `farm_url` on the hub's `/info` response. That is the hub telling a client
  its canonical address, and renaming it is a **wire-format change** — three
  mirrors and the shared test vectors, per the `wire-format-change` skill. Not
  something to tidy up in passing.
- `splitHubPathPrefix` in `packages/core/parseHubInput.ts`. One host can serve
  several hubs under `/hub/<slug>` paths, and a client has to parse that to
  join them. It handles a URL shape, not a feature.

`recovery.rs` in the Tauri shell used to be `farm.rs`: identity recovery and
key rotation had only ever been filed there by accident.

---

## Commands

From the repo root:

```bash
pnpm build          # build all packages + apps
pnpm typecheck      # tsc --noEmit across every project — run this before declaring done
```

Shared package suites:

```bash
cd packages/core && pnpm test    # incl. wire-format + backup test vectors
cd packages/ui && pnpm test      # component/util suites
```

Web app (`apps/web`):

```bash
npm run dev
npm run build        # tsc && vite build              -> dist      (user build)
npm run build:hub    # tsc && vite build --mode hub   -> dist-hub  (hub build)
npm run typecheck
npm run test
npm run check-i18n   # translation coverage
npm run check-hardcoded  # no NEW hardcoded UI strings (baseline-gated)
node scripts/check-hub-build.mjs   # asserts the hub build really dropped the screens
```

Desktop app (`apps/desktop`):

```bash
npm run dev          # Tauri dev with live-reload (opens the window)
npm run dev:web      # frontend only (Vite on 1420, no Tauri shell)
npm run build        # tsc + vite build + Tauri binary
npm run typecheck
npm run test
```

Desktop Rust shell only:

```bash
cd apps/desktop/src-tauri && cargo check && cargo test
```

To actually run and drive the web client, use the **`run-web`** skill in
`.claude/skills/`; for two-client voice testing, **`voice-e2e`**. You need a hub:
either point at one you run yourself (see the
[Wavvon-server](https://github.com/Wavvon/Wavvon-server) repo) or at any hub you
have an invite to.

---

## Architecture

### Shared packages

- **`core`** — platform-agnostic TypeScript. Wire types + signing (a byte-for-byte mirror of the server's `identity` crate, incl. recovery envelopes), the cross-platform `.wavvon-backup` format (Argon2id + AES-256-GCM, one account per file, shared test vector with the Rust implementations), invite/URL parsing, reconnect backoff, crypto (`@noble/*`, `@scure/bip39`). No React. Has a vitest suite.
- **`ui`** — THE component home: shared React 19 components (message stream, composer, sidebars, `ContentArea`, `HubAdminPage` + admin sections, `ChannelSettingsModal`, `SettingsShell` + tabs, events/polls/forum, recovery, backup), the single canonical `styles.css`, and shared utils/workers. Has a vitest suite.
- **`i18n`** — i18next + i18next-icu, shared catalogs (en/it/es/de).

### Apps

**`apps/web`** — Vite + React 19, no Tauri. Multi-account identities in IndexedDB
plus `wavvon:acct:<pubkey>:*` localStorage namespaces. `src/platform/` provides
the HTTP/WebSocket adapter. **Web is the delivery target and source of truth.**

**`apps/desktop`** — Tauri 2 + React 19, multi-account: a `~/.wavvon/accounts.json`
registry plus one directory per account (identity, pairing, home hubs, DM ratchet
state, per-account local store); `AccountRoot.tsx` remounts
`<App key={activeAccountId}>` on switch with a voice guard. Rust side in
`src-tauri/src/` — notable modules: `accounts.rs` (registry + purge-on-remove),
`backup.rs` (.wavvon-backup, must match the core test vector), `identity.rs`
(wire mirror), `soundboard.rs`, `local_store.rs` (per-account vs device-global
split), plus one file per command domain.

### `crates/voice` — Rust audio pipeline

Used by the desktop shell. Chain: cpal (capture/playback) -> nnnoiseless
(RNNoise denoise) -> soundboard clip mixing (`soundboard.rs`: Ogg-Opus demux +
decode, summed post-denoise so RNNoise can't eat the clip) -> audiopus (Opus
encode/decode) -> ringbuf (bridges the real-time audio thread and tokio async)
-> UDP transport -> hub relay.

---

## The sharing model

This is the part most likely to trip you up.

- **Web is the source of truth.** New components ship straight into `packages/ui`.
- Components in `packages/ui` are **prop-only**: no closures over App state, no app imports, no platform imports. Data access travels in through callback / actions-object props (`ForumActions`, `MessageRowActions`, ...). Platform-bound features are optional props an app may omit.
- Parity work on an existing component means **hoisting the web copy into `packages/ui`** and adapting desktop — not hand-porting into desktop's own copy.
- When the two clients diverge on a feature, converge on the **union**. No shipped capability gets dropped.
- Only `App.tsx` (the real state orchestrator), the `PinnedMessages` pair, and per-app action-wiring wrappers stay app-local.
- `packages/ui/src/hooks/` holds shared hooks, but only **network-free** ones — UI state machines. Anything that fetches stays in the app.

**Platform adapter contract.** Desktop calls
`invoke<T>('command_name', { argName: value })` from `@tauri-apps/api/core`
(camelCase args; Tauri translates to snake_case) and subscribes with
`listen<T>('event_name', handler)`, storing the unlisten for cleanup. Web has no
Tauri runtime — `apps/web/src/platform/` provides HTTP/WebSocket equivalents.
When a shared component gains a new platform dependency, **wire both sides**: a
web `platform/commands/` wrapper and a desktop Tauri command — or an optional
prop plus a precise gap note in the wiki's `client-parity.md`.

---

## Non-obvious constraints

**Wire-format changes are cross-repo operations.** The signing bytes in
`packages/core/src/identity/wire.ts` and `apps/desktop/src-tauri/src/identity.rs`
must match the server's `identity` crate **byte-for-byte**, pinned by shared test
vectors. Same discipline for the `.wavvon-backup` format (core TS + desktop
`backup.rs` assert one fixed vector). Use the **`wire-format-change`** skill.

**Recovery/attestation envelopes are signed with the roster identity key** — the
key the hub knows the user by — NOT the derived multi-device master key. The
master signs only multi-device material (subkey certs, etc.). Getting this
backwards was a real bug on both clients.

**Holding a `subkey_cert` does NOT mean "this is a paired device".** Every
device self-certifies at its first hub auth (`ensureSelfDeviceCert`), so the
entropy-holding device has one too. Use `holdsMasterSeed(account)` — a paired
device's seed derives a *different* master than the cert it was handed names.
`!!account.subkey_cert` was the old proxy in four places, and it inverts under
the new behaviour: read as "paired", it would silently stop every identity from
publishing a home hub designation.

**Tauri command shape**: `#[tauri::command]`, return `Result<T, String>`, never
unwrap inside. JS calls use camelCase. **Omitted-vs-null trap**: Tauri collapses
"arg omitted" and "arg explicitly null" into the same Rust `None` — for hub PATCH
routes with tri-state semantics, build the JSON body inserting only `Some`
fields, or unrelated updates will wipe fields (this bit twice: role color/icon,
banner sources).

**Desktop file storage**: per-account JSON files under
`~/.wavvon/accounts/<pubkey>/` via the `accounts.rs` path helpers (the old flat
`~/.wavvon/*.json` layout is legacy and ignored); device-global files
(voice/appearance) stay at the root — match the split in `local_store.rs`.

**Never branch on the hub's `version`.** `GET /info` carries `capabilities`, a
list of feature strings; ask `hubSupports(hubId, cap)` /
`activeHubSupports(cap)` (web `platform/session.ts`) and treat unknown as false.
Each hub serves its own baked-in copy of the web client and that copy is
multi-hub — the client served by hub A talks to hubs B and C, so there is no
"client and server update together".

**Paginated endpoints need a client that pages.** The hub's list dialect is an
array plus `limit` and a keyset cursor. Walk to exhaustion rather than trusting
one page — that is why `fetchAllUsers` (web) and `list_users` (desktop) loop.

**Silent fallthroughs are the bug class to watch for here.** Desktop's WebSocket
event enum matched unknown types as `Other => {}`, so four hub features were
simply absent with no symptom, for months. When you add a catch-all arm, make the
unknown case say something.

**Its sharpest form: a transient failure read as a definitive answer.** Four
bugs on 2026-09-07 were one shape — a `catch` that turned "could not ask" into
"the answer is no", where the caller could not tell the difference:

- `restorePersistedHubs` dropped a hub whose startup re-auth met a 429, so the
  user's communities vanished and the welcome screen came back;
- the socket asked for a fresh token past its retry threshold and `return`ed
  without arming its own retry, so a re-auth that failed ended the session in
  place while the UI still said "Reconnecting…";
- `fetchDhKey` answered `null` for both "no key published" and "the request
  failed", and `sendDm` read `null` as "cannot encrypt" — so a rate-limited
  moment sent a DM **in the clear**;
- and the demo bot exited outright on a 429 while waiting to be invited.

The tell is a fallback that is indistinguishable from a legitimate state:
empty list, no key, not a member, disconnected. When you write one, ask what
else produces that state — and if a network failure is on the list, either
retry it or refuse. **Refusing is the safe direction on anything touching
confidentiality**: `sendDm` now takes no answer over a guess. The lenient
reading stays only where a failure and an absence genuinely mean the same
thing (voice key distribution skips that peer either way), and says so.

**Two-axis state model.** Community-axis state (channels, messages, roles) lives
on community hubs. Personal-axis state (prefs, DM history, block/mute/ignore,
home hub list, custom themes, drafts) lives on the user's home hub(s). Don't mix
them.

**Identity is a keypair, not an account.** No email, password, or username.
Identity = Ed25519 public key (hex). Multi-device via BIP39 master phrase +
signed subkey certs (QR pairing). A device certifies **itself** on its first
hub connect and publishes a `HomeHubList` naming that hub if it has none —
`ensureSelfDeviceCert` then `ensureHomeHubDesignation`, in that order, since
the roster→master link has to exist before the list it points at. Naming a
device in Settings is cosmetic and just re-issues the cert. Recovery = phrase
import (canonical), `.wavvon-backup` file (secondary, works cross-client), or
per-hub recovery contacts (vouch -> admin decides). Both clients are
multi-account; account lists are device-local and never synced to a hub.

---

## Tests

vitest suites in `packages/core`, `packages/ui`, `apps/web`, `apps/desktop`. The
desktop Rust shell has `cargo test` under `apps/desktop/src-tauri`.

**Unit suites are not enough for cross-client flows.** A set of recovery bugs in
July 2026 passed every suite and was caught only by driving the real apps. Use
the `run-web` skill; say plainly when you could not verify something visually.

---

## Conventions

- Code comments in **English**, and only when the WHY is non-obvious — a hidden constraint, a workaround, surprising behavior. Don't explain WHAT.
- No comments in GitHub Actions workflow files — explain the choice in the commit message or the docs.
- **Reuse existing CSS classes** in `packages/ui/src/styles.css` before inventing new ones.
- Type-only imports for interfaces. One component per file, keep them small.
- Prefer one fixed home per UI control — avoid context-dependent relocation.
- Any user-visible string goes through i18n; run `npm run check-i18n` from `apps/web` if you touched catalogs.
- **Four languages, all four in the bundle, and that is on purpose.** Measured
  2026-08-29 with two real builds of `apps/web`: the three unused catalogues
  cost **44.7 KB brotli out of 541 KB — 8%**, about 15 KB brotli per language
  (much less than the ~25 KB each weighs alone, since the 1,336 keys are
  identical across catalogues and compress away). Don't split them into
  per-language chunks yet and don't re-measure: the trigger is the **fifth**
  language, and at that point it is one line in `initI18n`, which already
  receives the language before the app mounts. Downloadable packs are a
  separate, larger thing gated on desktop delivery — see the docs wiki's
  `future-features.md`.
- **Two i18n checks, and they catch different things.** `check-i18n` proves
  three things about the catalogs: every key in `en.json` exists in it/es/de,
  every message parses as ICU, and every translation carries the same
  placeholder names as its English original. It cannot see a string that never
  became a key, which is how ~1,100 hardcoded English strings accumulated in an
  app advertising four locales — every catalog "complete", most of the UI
  English. `check-hardcoded` scans the tracked `.tsx` files instead, against a
  per-file baseline in `packages/i18n/hardcoded-baseline.json`: a file may not
  gain a literal, and the count only ratchets down. Translated a batch? Re-run
  `node packages/i18n/find-hardcoded.mjs --baseline` to bank it.
- **Messages are ICU: `{name}`, one brace.** The app initialises i18next with
  i18next-icu, so `{{name}}` — i18next's own interpolation — is a malformed ICU
  argument and renders as its own braces on screen. Two keys shipped that way
  and neither check could see it until the ICU parse landed. Plurals are ICU
  too: `{count, plural, one {# reply} other {# replies}}`, never a
  `=== 1 ? "reply" : "replies"` ternary, which no translator can fix for a
  language with three plural forms.
- Translating a file, the parts no scan-and-replace handles: a local
  `const t = …` silently shadows the translator inside its own callback (and
  TypeScript is happy either way); a second component in the same file needs
  its own `useTranslation()`; `window.confirm("…")` is user-facing text that no
  JSX scan finds by shape; a paragraph wrapped across source lines does not
  match its own string literal; and prose broken around `<strong>`/`<em>` wants
  one key, not fragments a translator cannot reorder.
- Design decisions go in the wiki's `decisions.md` (newest entry at the top). Mark superseded entries; don't delete them.
- Competitor references are allowed — factual, no logos, no disparagement.
