import type { GameLaunchCard } from "@wavvon/core";

export interface Attachment {
  name: string;
  mime: string;
  data_b64: string;
}

export interface Reaction {
  emoji: string;
  count: number;
  me: boolean;
}

export interface ReplyContext {
  message_id: string;
  sender: string;
  sender_name: string | null;
  content_preview: string;
}

export interface Message {
  id: string;
  channel_id: string;
  sender: string;
  sender_name: string | null;
  content: string;
  created_at: number;
  edited_at: number | null;
  attachments?: Attachment[];
  reactions?: Reaction[];
  reply_to?: ReplyContext | null;
  visible_to_pubkey?: string | null;
  embeds?: Embed[];
  components?: ComponentRow[];
  is_bot_sender?: boolean;
  reply_count?: number;
  /** Bot-authored "Play" launch card (bot-capability-layer.md §2). Bot messages only. */
  game?: GameLaunchCard | null;
}

export interface Embed {
  title?: string;
  url?: string;
  description?: string;
  color?: string;
  fields?: EmbedField[];
  thumbnail_url?: string;
  image_url?: string;
  footer?: { text: string };
}

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface ComponentRow {
  type: "row";
  components: BotComponent[];
}

export type BotComponent = BotButton | BotSelect;

export interface BotButton {
  type: "button";
  custom_id: string;
  label: string;
  style?: "primary" | "secondary" | "danger";
  disabled?: boolean;
}

export interface BotSelect {
  type: "select";
  custom_id: string;
  placeholder?: string;
  min_values?: number;
  max_values?: number;
  options: SelectOption[];
}

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
}

export interface User {
  public_key: string;
  display_name: string | null;
  avatar: string | null;
  online: boolean;
  /** Presence while online: absent/null = plain online, "away", "dnd". */
  status?: string | null;
  /** Optional short custom status text (only present while online). */
  status_custom?: string | null;
  group_role: string | null;
  is_bot?: boolean;
  is_webhook?: boolean;
  /** MM-DD (never a year) — null/absent when unset or the hub has birthdays
   *  disabled (the server omits it entirely in that case). */
  birthday?: string | null;
  /** Final, server-resolved name color (`#rrggbb`) per the hub's
   *  `name_color_mode` — clients render it as-is, no priority logic. Null
   *  when nothing resolved (mode "none", or neither role nor user color set). */
  name_color: string | null;
}

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  domain: string;
}

export interface AllianceSharedChannel {
  channel_id: string;
  channel_name: string;
  hub_public_key: string;
  hub_name: string;
  // Optional: desktop's own AllianceSharedChannel (apps/desktop/src/types.ts)
  // hasn't picked up the v2 alliance-sharing fields yet. Keep these optional
  // here so AllianceView stays a valid sink for both the old and new shape.
  channel_type?: "text" | "forum" | "banner" | "spawner";
  parent_id?: string | null;
  is_category?: boolean;
  /** Policy governing writes proxied from other alliance-member hubs into
   * this channel (forum federation phase 2). Absent from peers that haven't
   * upgraded yet (and from desktop's own AllianceSharedChannel, which hasn't
   * picked up alliance-forum access at all); treat as "replies_only", the
   * hub-side column default. */
  forum_remote_write?: "none" | "replies_only" | "posts_and_replies";
}

export interface AllianceInfo {
  id: string;
  name: string;
  created_by: string;
  created_at: number;
}

export interface Conversation {
  id: string;
  conv_type: string;
  members: string[];
  created_at: number;
  last_activity_at?: number;
}

export interface DmMessage {
  id?: string;
  sender: string;
  sender_name: string | null;
  content: string;
  timestamp: number;
  attachments?: Attachment[];
  is_encrypted?: boolean;
  /** True when at least one outbox row for this message has bounced
   *  (retries exhausted). Renders a delivery-failed mark next to the
   *  message. False/missing for received messages and not-yet-bounced sends. */
  delivery_failed?: boolean;
}

export interface BlockEntry {
  pubkey: string;
  since: number;
}

export interface IgnoreEntry {
  pubkey: string;
  since: number;
}

export interface BotAppLaunchEvent {
  type: "bot_app_launch";
  bot_id: string;
  title: string;
  description: string;
  channel_id: string;
}

export interface BotCommandDef {
  name: string;
  description: string;
}

export interface BotProfile {
  pubkey: string;
  name: string;
  avatar_url: string | null;
  description: string | null;
  commands: BotCommandDef[];
  /** Profile-declared game descriptor (bot-capability-layer.md §11): drives
   *  the directory card's Play affordance. Absent = bot never declared one. */
  game?: GameLaunchCard | null;
}

export interface HubEmoji {
  id: string;
  name: string;
  url: string;
}

/** A claimant's current voice standing relative to an event (events.md §7.5).
 *  Computed by the caller — this component never inspects voice/assignment
 *  state itself, only renders what it's told. */
export type ClaimantVoiceStatus =
  | { kind: "in_voice"; channelName: string }
  | { kind: "assigned"; channelName: string; voiceOnly: boolean }
  | { kind: "none" };

/** One staging-panel bucket: an event slot's claimants, or the synthesized
 *  "Unassigned" bucket (`id: null`) for plain "going" RSVPs with no slot. */
export interface StagingGroup {
  id: string | null;
  name: string;
  capacity: number | null;
  claimed: number | null;
  claimants: string[];
}

export interface Hub {
  hub_id: string;
  hub_name: string;
  hub_url: string;
  hub_icon: string | null;
  is_active: boolean;
}

export type NotifyMode = "all" | "mentions" | "silent";

export interface VoiceParticipant {
  public_key: string;
  display_name: string | null;
  /** Set only for an alliance-voice visitor: the hub that vouched for them
   *  (alliances.md). Their name is hub-asserted, not proven, so it is
   *  rendered as mediated — never as a plain member name. */
  visiting_from?: string | null;
}

export interface WhisperTarget {
  type: "user" | "channel" | "role";
  id: string;
  label: string;
}

/** The dedicated whisper-reply key: press to whisper straight back at the
 *  most recent inbound whisperer. Distinct from any per-list keybind. */
export interface WhisperReplyBind {
  key?: string;
  mode: "hold" | "toggle";
}

export interface WhisperList {
  id: string;
  name: string;
  targets: WhisperTarget[];
  keybind?: string;
  /** Hold-to-whisper vs. toggle-on-keydown while `keybind` is set. Defaults
   *  to "hold" when absent (lists saved before this shipped). */
  keybindMode?: "hold" | "toggle";
}

/** Ephemeral "X played Y" attribution chip shown near the soundboard trigger. */
export interface SoundboardChip {
  id: string;
  public_key: string;
  clip_name: string;
}

export interface PollOption {
  id: string;
  text: string;
  vote_count: number;
  voted: boolean;
}

export interface Poll {
  id: string;
  channel_id: string;
  question: string;
  options: PollOption[];
  total_votes: number;
  created_by: string;
  created_at: number;
  ends_at: number | null;
  is_deleted: boolean;
}

export type RsvpStatus = "going" | "maybe" | "not_going";

// Matches the hub's RsvpEntry field name exactly (hub/src/routes/events.rs)
// — GET /events/:id/rsvps returns `user_pubkey`, not `pubkey`.
export interface EventRsvp {
  user_pubkey: string;
  status: RsvpStatus;
}

export interface EventSlot {
  id: string;
  name: string;
  capacity: number | null;
  position: number;
  claimed: number;
  claimants: string[];
}

export interface HubEvent {
  id: string;
  channel_id?: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: number;
  // Matches the hub's `ends_at` field name (see hub/src/routes/events.rs).
  ends_at: number | null;
  creator_pubkey?: string;
  created_at: number;
  rsvp_counts: { going: number; maybe: number; not_going: number };
  slots: EventSlot[];
  reminder_minutes: number | null;
  reminder_sent_at: number | null;
  // events.md §5/§6: hub-level visibility and sub-channel card fan-out.
  // Both default false server-side and are always present on responses.
  hub_wide: boolean;
  propagate_to_children: boolean;
}

// A queued voice-move (events.md §7.3) — persisted when a staging-panel
// move targets a member who isn't in voice yet, applied on their next join.
export interface EventMoveAssignment {
  user_pubkey: string;
  target_channel_id: string;
  assigned_by: string;
  created_at: number;
  voice_only: boolean;
}

// ---- Forum ----

export interface ReactionCount {
  emoji: string;
  count: number;
  me: boolean;
}

export interface ForumAttachment {
  url: string;
  name: string;
  mime: string;
  size: number;
}

/** Tag assignment as it rides along a post (forum.md §10.2) — just enough
 * to render a chip; the full definition (position, created_at) lives in
 * ForumTagDef and is only needed by the admin tag editor. */
export interface TagRef {
  id: string;
  label: string;
  color?: string | null;
}

/** A channel's tag vocabulary entry (forum.md §10.1), admin-curated via
 * `manage_posts`. `channel_id`/`position`/`created_at` matter to the admin
 * editor and list ordering; post-facing chips only need `TagRef`. */
export interface ForumTagDef {
  id: string;
  channel_id: string;
  label: string;
  color: string | null;
  position: number;
  created_at: number;
}

export interface PostSummary {
  id: string;
  channel_id: string;
  author_pubkey: string;
  title: string | null;
  created_at: number;
  edited_at: number | null;
  is_pinned: boolean;
  is_locked: boolean;
  reply_count: number;
  last_activity_at: number;
  is_deleted: boolean;
  unread_reply_count?: number | null;
  reactions?: ReactionCount[];
  attachments?: ForumAttachment[];
  /** Origin hub public key hex when authored through the alliance forum
   * write-proxy (forum federation phase 2); absent for locally-authored posts. */
  author_hub?: string | null;
  /** Absent on older hubs that haven't shipped tags yet — default to []. */
  tags?: TagRef[];
}

export interface ReplyView {
  id: string;
  post_id: string;
  author_pubkey: string;
  body: string | null;
  created_at: number;
  edited_at: number | null;
  reply_to_id: string | null;
  is_deleted: boolean;
  reactions?: ReactionCount[];
  attachments?: ForumAttachment[];
  author_hub?: string | null;
}

export interface PostDetail extends PostSummary {
  body: string | null;
  replies: ReplyView[];
  reply_cursor?: string;
}

export interface PostListResponse {
  posts: PostSummary[];
  cursor?: string;
}

// ---- Hub admin: alliances, external bots, webhooks, hub icons, survey ----

export interface Alliance {
  id: string;
  name: string;
  created_by: string;
  created_at: number;
}

export interface AllianceMember {
  hub_public_key: string;
  hub_name: string;
  hub_url: string;
  joined_at: number;
}

export interface AllianceDetail extends Alliance {
  members: AllianceMember[];
}

/** Returned by the hub's `POST /alliances/{id}/invite` — `hub_url` is always
 *  "self" from the issuing hub's own point of view, so callers pair it with
 *  their own known hub URL rather than reading it back. */
export interface AllianceInvite {
  token: string;
  alliance_id: string;
  alliance_name: string;
  hub_url: string;
}

export interface PendingAllianceInvite {
  id: string;
  alliance_id: string;
  alliance_name: string;
  from_hub_url: string;
  from_hub_name: string;
  from_hub_public_key: string;
  invite_token: string;
  created_at: number;
  message: string | null;
}

export interface SharedChannel {
  channel_id: string;
  channel_name: string;
  hub_public_key: string;
  hub_name: string;
  channel_type: "text" | "forum" | "banner" | "spawner";
  parent_id: string | null;
  is_category: boolean;
  forum_remote_write?: "none" | "replies_only" | "posts_and_replies";
  /** Whether members of allied hubs may join voice here (alliances.md).
   *  Absent from peers that have not upgraded; treat as "allowed", the
   *  hub-side column default. */
  voice_remote_join?: "allowed" | "none";
}

export interface ExternalBotRow {
  public_key: string;
  local_note: string | null;
  display_name: string | null;
  approval_status: "pending" | "active" | "removed";
  last_seen_at: number | null;
}

export interface ExternalBotInviteResult {
  bot_invite_token: string;
  pubkey: string;
}

export interface WebhookInfo {
  id: string;
  display_name: string;
  channel_id: string;
  channel_name: string | null;
  webhook_url: string;
  created_by: string;
  created_at: number;
}

export interface WebhookCreatedResult {
  id: string;
  webhook_url: string;
}

export interface HubIcon {
  id: string;
  name: string;
  svg_content: string;
  uploaded_by: string;
  created_at: number;
}

export interface SurveyChoice {
  id: string;
  label: string;
  display_order: number;
  role_ids: string[];
}

export interface SurveyQuestion {
  id: string;
  prompt: string;
  kind: "text" | "choice";
  required: boolean;
  display_order: number;
  choices?: SurveyChoice[];
}

export interface SurveyAdmin {
  id: string;
  enabled: boolean;
  questions: SurveyQuestion[];
}

export interface SurveyResponseView {
  response_id: string;
  pubkey: string;
  display_name?: string;
  submitted_at: number;
  answers: { question_id: string; prompt: string; choice_label?: string; text_answer?: string }[];
}

export interface GlobalSearchResult {
  message_id: string;
  channel_id: string;
  channel_name: string;
  sender: string;
  sender_name: string | null;
  content_preview: string;
  created_at: number;
}

export interface LobbyStatusInfo {
  status: string;
  required_level: number;
  current_level: number;
  entered_at?: number | null;
  welcome_md?: string | null;
}

export interface LobbyWelcomeInfo {
  welcome_md: string;
  hub_name?: string;
  required_level?: number;
}

export interface SubmitPowResultInfo {
  promoted: boolean;
  new_level: number;
}

export interface HubListing {
  hub_pubkey: string;
  hub_url: string;
  name: string;
  description: string | null;
  icon: string | null;
  invite_only: boolean;
  min_security_level: number;
  invite_code: string | null;
  bio: string;
  tags: string[];
  language: string;
  nsfw?: boolean;
  badges?: { payload: { label: string; issuer_url: string; issuer_pubkey: string }; signature: string }[];
}

export interface RoleInfo {
  id: string;
  name: string;
  permissions: string[];
  priority: number;
  display_separately?: boolean;
  color: string | null;
  icon: string | null;
  category_id: string | null;
}

export interface RoleCategory {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  position: number;
  created_at: number;
}

export interface Friend {
  public_key: string;
  display_name: string | null;
  /** When non-null, this friend lives on another hub. DMs to them will be
   *  routed to this hub via the federated DM outbox. */
  hub_url: string | null;
  since: number;
}

export interface FavoriteHub {
  url: string;
  name: string;
  icon: string | null;
}

export interface BadgeSummary {
  id: string;
  label: string;
  color?: string;
}

// ---------------------------------------------------------------------------
// Shared profile editor (settings-ia.md §5 — the 2026-07-12 converged model:
// one local default + per-hub /me card). Account is generalized down to
// {id, account_label} so both web's IndexedDB IdentityRecord and desktop's
// Rust-backed AccountSummary satisfy it without either platform's account
// model leaking into packages/ui.
// ---------------------------------------------------------------------------

export interface ProfileAccountRef {
  id: string;
  account_label?: string;
}

// Props shared by every settings tab that can act on a non-active local
// account. Generic over the platform's own account shape (web's IndexedDB
// IdentityRecord, desktop's Rust-backed AccountSummary) — packages/ui only
// needs `id` and `account_label` (ProfileAccountRef), so this stays platform-
// free while each app's account type satisfies it structurally.
export interface PerAccountProps<TAccount extends ProfileAccountRef = ProfileAccountRef> {
  accounts: TAccount[] | null;
  activeId: string | null;
  managing: TAccount | null;
  onManagingChange: (id: string) => void;
}

export interface ProfileDraftFields {
  display_name: string;
  avatar: string | null;
  bio: string | null;
  pronouns: string | null;
  status_message: string | null;
  activities: string | null;
  accent_color: string | null;
  /** The member's raw name-color choice (hex `#rrggbb`, or null/unset). The
   *  hub resolves this against `name_color_mode` into `User.name_color`/
   *  `UserProfile.name_color` for rendering — this is only the write side. */
  name_color: string | null;
  cover: string | null;
  favorite_hubs: FavoriteHub[];
  show_hubs: boolean;
  /** MM-DD, never a year. null = unset/cleared. */
  birthday: string | null;
}

export interface HubProfileSnapshot extends Omit<ProfileDraftFields, "display_name"> {
  // Unlike ProfileDraftFields (a write payload, where display_name is
  // required), a hub's read response can have no display_name set yet.
  display_name: string | null;
  /** Earned on that hub, read-only — shown in the editor card as members
   *  would see them (labels only). */
  badges: string[];
}

// A member's own earned hub certifications + achievement badges, aggregated
// from every hub they're on.
export interface MyCertification {
  payload: {
    subject_kind: string;
    issuer_pubkey: string;
    issuer_url: string;
    subject_pubkey: string;
    member_since: number;
    standing: "good" | "revoked";
    pow_level: number | null;
    issued_at: number;
    expires_at: number;
    capabilities: string[];
    label?: string | null;
    description?: string | null;
    icon?: string | null;
  };
  signature: string;
  /** Which hub this cert was read from (client-side annotation). */
  hub_url?: string;
}

export interface ProfileEditorActions {
  getMyProfileOnHub: (hubId: string, publicKey: string) => Promise<HubProfileSnapshot>;
  updateMyProfileOnHub: (hubId: string, profile: ProfileDraftFields) => Promise<void>;
  /** Sentinel error message thrown by getMyProfileOnHub/updateMyProfileOnHub
   *  when the hub has no live session this run (saved but never connected,
   *  or offline) — shown as a friendly note instead of a raw error. */
  noHubSessionError: string;
  loadDefaultProfile: (accountId: string) => ProfileDraftFields | null;
  saveDefaultProfile: (profile: ProfileDraftFields, accountId: string) => void;
  loadFollowsDefault: (accountId: string) => string[];
  saveFollowsDefault: (hubIds: string[], accountId: string) => void;
  /** Identity-wide badges shown live in the Bio tab's default context —
   *  the same read MyCertificationsSection uses for its full list. */
  listMyCertifications: (pubkey: string) => Promise<MyCertification[]>;
}

export interface UserProfile {
  pubkey: string;
  display_name: string | null;
  avatar: string | null;
  bio: string | null;
  pronouns: string | null;
  status_message: string | null;
  activities: string | null;
  accent_color: string | null;
  cover: string | null;
  favorite_hubs: FavoriteHub[];
  show_hubs: boolean;
  joined_at: number;
  roles: RoleInfo[];
  badges: BadgeSummary[];
  birthday: string | null;
  /** Final, server-resolved name color — see User.name_color. */
  name_color: string | null;
}

export interface PublicHubEntry {
  hub_url: string;
  hub_name: string;
  joined_at: number;
}

export interface PublicHubProfile {
  pubkey: string;
  display_name: string;
  avatar: string | null;
  public_hubs: PublicHubEntry[];
  issued_at: number;
  signature: string;
}

export interface HubStreamInfo {
  channel_id: string;
  stream_id: string;
  sharer_pubkey: string;
  kind: "screen" | "webcam";
  mime: string;
  has_audio: boolean;
}

export interface ActiveStream {
  stream_id: string;
  sharer_pubkey: string;
  kind: "screen" | "webcam";
  mime: string;
  has_audio: boolean;
}

// ---------------------------------------------------------------------------
// Channel permission overwrites (Nested Channels §3.6) — ChannelSettingsModal
// ---------------------------------------------------------------------------

export interface ChannelRoleOverwrites {
  allow: string[];
  deny: string[];
}

export interface ChannelRolePermissions {
  role_id: string;
  role_name: string;
  overwrites: ChannelRoleOverwrites;
  inherited: string[];
  effective: string[];
}

export interface ChannelPermissionsResponse {
  channel_id: string;
  roles: ChannelRolePermissions[];
}

// ---------------------------------------------------------------------------
// HubAdminPage (parity hoist, 2026-07-20)
// ---------------------------------------------------------------------------

export interface PendingUser {
  public_key: string;
  display_name: string | null;
  first_seen_at: number;
}

/** Hub-wide policy for resolving a member's name color when both a role
 *  color and a user-chosen name_color are present. Default "role_over_user". */
export type NameColorMode = "user_over_role" | "role_over_user" | "role_only" | "user_only" | "none";

export interface MemberAdminInfo {
  public_key: string;
  display_name: string | null;
  online: boolean;
  first_seen_at: number;
  last_seen_at: number;
  roles: RoleInfo[];
}

export interface BanInfo {
  target_public_key: string;
  banned_by: string;
  reason: string | null;
  created_at: number;
}

export interface InviteInfo {
  code: string;
  created_by: string;
  max_uses: number | null;
  uses: number;
  expires_at: number | null;
  created_at: number;
  /** Role granted to the joining user in addition to `builtin-everyone`, if any. */
  grant_role_id: string | null;
}

export interface HubSelfTagSettings {
  self_tags: string[];
  nsfw: boolean;
}

export interface HubBadge {
  id: string;
  label: string;
  issuer_url: string;
}

export interface PendingBadgeOffer {
  id: string;
  label: string;
  issuer_url: string;
}

export interface SoundboardClip {
  id: string;
  name: string;
  emoji: string | null;
  uploader: string;
  duration_ms: number;
  size_bytes: number;
  created_at: number;
}

export interface AuditLogEntry {
  seq: number;
  event_type: string;
  at: number;
  actor_pubkey: string | null;
  target_pubkey: string | null;
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  next_cursor: number | null;
}

export interface CertIssuance {
  subject_pubkey: string;
  issued_at: number;
  expires_at: number;
  standing: "good" | "revoked";
}

export interface CertAdmissionSettings {
  cert_mode: "none" | "any" | "trusted";
  cert_auto_issue: boolean;
  cert_min_age_days: number;
  cert_validity_days: number;
  cert_trusted_issuers: string[];
  /** issuer pubkey → base URL, for issuers this hub can pull a portfolio
   *  from (hub-certifications.md §11). Sparse: an issuer without an
   *  address is still trusted, just not pullable. Absent from hubs that
   *  predate the field. */
  cert_issuer_urls?: Record<string, string>;
}

export type ChallengeMode = "off" | "click" | "puzzle" | "both";
export type ChallengeDifficulty = "easy" | "medium";

// ---- Recovery contacts / rotation-attestation (recovery-attestation.md) ----

export interface RecoveryContactItem {
  pubkey: string;
  added_at: number;
  display_name?: string | null;
}

export interface RecoveryAdminRequest {
  id: string;
  old_pubkey: string;
  new_pubkey: string;
  status: string;
  reason: string | null;
  created_at: number;
  attestation_count: number;
}

/** GET /recovery/rotation-request/:id — the bundle a reviewing contact signs,
 *  plus progress. Also what a requester polls for its own open request. */
export interface RecoveryRequestBundle {
  id: string;
  hub_pubkey: string;
  old_pubkey: string;
  new_pubkey: string;
  nonce: string;
  status: string;
  attestation_count: number;
  threshold: number;
}

/**
 * What another hub has said about a member, from the federated ban lists this
 * hub subscribes to.
 *
 * `policy` is the half that makes it readable: `hard-reject` means the entry
 * would have refused admission, `soft-flag` that it did not and is here to be
 * read. Without it the two are indistinguishable and mean opposite things.
 * `unknown` is an entry whose source is no longer subscribed — inert, kept
 * visible rather than hidden.
 *
 * Deliberately not a verdict. Another hub's ban is another hub's decision,
 * made for reasons this one cannot see; a moderator gets the source, the
 * reason and the date, and makes their own.
 */
export interface MemberHistoryEntry {
  source_hub_pubkey: string;
  policy: "hard-reject" | "soft-flag" | "unknown";
  reason?: string | null;
  added_at: number;
}

/** A member-filed report about one message, as the hub returns it from
 *  `GET /admin/reports`. */
export interface Report {
  id: string;
  message_id: string;
  message_content: string | null;
  channel_id: string;
  reporter_pubkey: string;
  reason: string;
  reported_at: number;
  status: string;
}

export type ReportAction = "dismiss" | "delete_message" | "ban_user";
