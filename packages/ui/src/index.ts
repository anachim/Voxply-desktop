export type {
  Attachment,
  Reaction,
  Message,
  AllianceSharedChannel,
  BlockEntry,
  IgnoreEntry,
  BotAppLaunchEvent,
  BotCommandDef,
  BotProfile,
  HubEmoji,
  ClaimantVoiceStatus,
  StagingGroup,
  Hub,
  NotifyMode,  ReactionCount,
  ForumAttachment,
  TagRef,
  ForumTagDef,
  PostSummary,
  ReplyView,
  PostDetail,
  PostListResponse,
  VoiceParticipant,
  PollOption,
  Poll,
  RsvpStatus,
  EventRsvp,
  EventSlot,
  HubEvent,
  EventMoveAssignment,
  AllianceInfo,
  Conversation,
  DmMessage,
  WhisperTarget,
  WhisperList,
  WhisperReplyBind,
  SoundboardChip,
} from "./types";
export { AudioProfileSection } from "./components/AudioProfileSection";
export { Avatar } from "./components/Avatar";
export { AvatarPicker } from "./components/AvatarPicker";
export { AccountLabelSuffix, PerAccountHint } from "./components/AccountScopeNote";
export { generateAvatarDataUrl, randomAvatarSeed } from "./utils/avatarGenerator";
export { MessageAttachments, PendingAttachments } from "./components/Attachments";
export { BlockIgnoreSection } from "./components/BlockIgnoreSection";
export { IdentityBackupSection } from "./components/IdentityBackupSection";
export type { IdentityBackupAccount, IdentityBackupSectionActions } from "./components/IdentityBackupSection";
export { passphraseStrength } from "./utils/passphraseStrength";
export type { PassphraseStrength } from "./utils/passphraseStrength";
export { BotAppLaunchCard } from "./components/BotAppLaunchCard";
export { BotCard } from "./components/BotCard";
export { ErrorRetry } from "./components/ErrorRetry";
export { DisplayNamePrompt } from "./components/DisplayNamePrompt";
export { FocusTrap } from "./components/FocusTrap";
export { GameCard } from "./components/GameCard";
export { GameModal } from "./components/GameModal";
export { HoverSubmenu } from "./components/HoverSubmenu";
export { HubClock } from "./components/HubClock";
export { ImagePicker } from "./components/ImagePicker";
export { KeyboardShortcuts } from "./components/KeyboardShortcuts";
export { MessageContent } from "./components/MessageContent";
export { TypingIndicator } from "./components/TypingIndicator";
export { VoiceMoveMenu } from "./components/VoiceMoveMenu";
export type { VoiceMoveChannelOption } from "./components/VoiceMoveMenu";
export { VoiceMoveToast } from "./components/VoiceMoveToast";
export { VoiceMovePromptModal } from "./components/VoiceMovePromptModal";
export { StagingPanel } from "./components/StagingPanel";
export { StagingSlotGroup } from "./components/StagingSlotGroup";
export { AllianceView } from "./components/content/AllianceView";
export { EmojiPicker } from "./components/content/EmojiPicker";
export { ReconnectBanner } from "./components/content/ReconnectBanner";
export { EMOJI_CATALOG, QUICK_REACTIONS } from "./emojiCatalog";
export { ForumView } from "./components/forum/ForumView";
export type { ForumActions, ForumAllianceContext } from "./components/forum/ForumView";
export { ForumTagPicker } from "./components/forum/ForumTagPicker";
export { ForumTagManager } from "./components/forum/ForumTagManager";
export type { ForumTagManagerActions } from "./components/forum/ForumTagManager";
export { toggleTagSelection } from "./utils/forumTags";
export { EventCard } from "./components/events/EventCard";
export type { EventStagingCapability } from "./components/events/EventCard";
export { EventComposer } from "./components/events/EventComposer";
export type { CreateEventPayload } from "./components/events/EventComposer";
export { EventsPanel } from "./components/events/EventsPanel";
export { PollCard } from "./components/polls/PollCard";
export { PollComposer } from "./components/polls/PollComposer";
export type {
  Alliance,
  AllianceMember,
  AllianceDetail,
  AllianceInvite,
  PendingAllianceInvite,
  SharedChannel,
  ExternalBotRow,
  ExternalBotInviteResult,
  WebhookInfo,
  WebhookCreatedResult,
  HubIcon,
  SurveyChoice,
  SurveyQuestion,
  SurveyAdmin,
  SurveyResponseView,
} from "./types";
export { AlliancesSection } from "./components/admin/AlliancesSection";
export type { AlliancesSectionActions } from "./components/admin/AlliancesSection";
export { ExternalBotSection } from "./components/admin/ExternalBotSection";
export type { ExternalBotSectionActions } from "./components/admin/ExternalBotSection";
export { WebhooksSection } from "./components/admin/WebhooksSection";
export type { WebhooksSectionActions } from "./components/admin/WebhooksSection";
export { HubIconsSection } from "./components/admin/HubIconsSection";
export type { HubIconsSectionActions } from "./components/admin/HubIconsSection";
export { SurveyAdminSection } from "./components/admin/SurveyAdminSection";
export type { SurveyAdminSectionActions } from "./components/admin/SurveyAdminSection";
export { SearchBar } from "./components/layout/SearchBar";
export type { GlobalSearchResult } from "./types";
export type { Report, ReportAction, ModerationSettings, BanlistSource, FederatedBanEntry, BanlistOverride } from "./types";
export { DiscoverPage } from "./components/hubs/DiscoverPage";
export type { HubListing } from "./types";
export { HubSetupWizard } from "./components/hubs/HubSetupWizard";
export type { HubSetupWizardActions, HubSetupWizardCreateChannelFields } from "./components/hubs/HubSetupWizard";
export { Lobby } from "./components/layout/Lobby";
export type { LobbyActions } from "./components/layout/Lobby";
export { HubSidebar } from "./components/layout/HubSidebar";
export type { LobbyStatusInfo, LobbyWelcomeInfo, SubmitPowResultInfo } from "./types";
export { resolveSessionScope } from "./utils/lobbyDecision";
export type {
  ReplyContext,
  Embed,
  EmbedField,
  ComponentRow,
  BotComponent,
  BotButton,
  BotSelect,
  SelectOption,
  User,
  LinkPreview,
} from "./types";
export { MessageEmbeds } from "./components/content/MessageEmbeds";
export { MessageReactions } from "./components/content/MessageReactions";
export { MessageComponents } from "./components/content/MessageComponents";
export { IgnoredMessagePlaceholder, URL_RE } from "./components/content/MessageHelpers";
export { LinkPreviewCard } from "./components/content/LinkPreviewCard";
export { LinkPreviewInMessage } from "./components/content/LinkPreviewInMessage";
export { ReactionPicker } from "./components/content/ReactionPicker";
export { MessageContextMenu } from "./components/content/MessageContextMenu";
export { MessageRow } from "./components/content/MessageRow";
export type { MessageRowActions } from "./components/content/MessageRow";
export { ChannelHeader } from "./components/content/ChannelHeader";
export { ConnectionStatus } from "./components/content/ConnectionStatus";
export { ChannelComposer } from "./components/content/ChannelComposer";
export { ChannelMessageList } from "./components/content/ChannelMessageList";
export { DmView } from "./components/content/DmView";
export { WelcomeInviteBanner } from "./components/content/WelcomeInviteBanner";
export { ContentArea } from "./components/content/ContentArea";
export { PinnedMessagesModal } from "./components/content/PinnedMessagesModal";
export type { PinnedMessageEntry } from "./components/content/PinnedMessagesModal";
export { ErrorBoundary } from "./components/ErrorBoundary";
export { SortableHubIcon, SortableChannelItem, SortableCategoryItem } from "./components/SortableItems";
export {
  PhoneOffIcon,
  MicOnIcon,
  MicOffIcon,
  DeafenIcon,
  ScreenShareIcon,
  CameraOnIcon,
  CameraOffIcon,
  PingIcon,
  CHANNEL_ICONS,
  ChannelIconGlyph,
  ChannelIcon,
} from "./components/Icons";
export { HubStreamsPanel } from "./components/HubStreamsPanel";
export type { HubStreamInfo } from "./types";
export { ScreenShareViewer } from "./components/ScreenShareViewer";
export type { ScreenShareViewerRef } from "./components/ScreenShareViewer";
export type { ActiveStream } from "./types";
export { MobileShell } from "./components/MobileShell";
export {
  SKINNABLE_TOKENS,
  validateSkin,
  readBaseToken,
  applySkinTokens,
  clearSkinTokens,
  downloadSkin,
  parseSkinFromRgba,
  splitRgba,
} from "./skinValidation";
export type { SkinBase, ThemeId, WavvonSkin, AppearanceState } from "./skinValidation";
export { SkinEditor, makeSeed } from "./components/SkinEditor";
export { SkinsGallery } from "./components/SkinsGallery";
export { AddHubModal } from "./components/hubs/AddHubModal";
export { QuickInviteModal, type QuickInviteModalActions } from "./components/hubs/QuickInviteModal";
export { WelcomeScreen } from "./components/layout/WelcomeScreen";
export { UserContextMenu } from "./components/users/UserContextMenu";
export type { UserContextMenuActions } from "./components/users/UserContextMenu";
export { UserListGrouped } from "./components/users/UserListGrouped";
export { UserProfileCard } from "./components/users/UserProfileCard";
export type { UserProfileCardActions } from "./components/users/UserProfileCard";
export { FriendsModal } from "./components/users/FriendsModal";
export type { FriendsModalActions } from "./components/users/FriendsModal";
export { AutoGrowTextarea } from "./components/profile/AutoGrowTextarea";
export { StatusBubble } from "./components/profile/StatusBubble";
export { GameEmojiRow } from "./components/profile/GameEmojiRow";
export {
  HEX_RE,
  safeRoleColor,
  distinguishingRoles,
  groupRolesByCategory,
  roleTintStyle,
  nameColorStyle,
} from "./utils/roleAppearance";
export type { RoleCategoryGroup } from "./utils/roleAppearance";
export type { NameColorMode } from "./types";
export { identityGradient, profileBannerStyle } from "./utils/identityColor";
export { insertAtLineStart } from "./utils/activityEmoji";
export type {
  RoleInfo,
  RoleCategory,
  Friend,
  FavoriteHub,
  BadgeSummary,
  UserProfile,
  PublicHubEntry,
  PublicHubProfile,
  MemberHistoryEntry,
} from "./types";
export type {
  ChannelRoleOverwrites,
  ChannelRolePermissions,
  ChannelPermissionsResponse,
} from "./types";
export { sanitizeSvgMarkup } from "./utils/svgSanitize";
export {
  CHANNEL_OVERWRITE_PERMISSIONS,
  deriveRowStates,
  buildOverwritePayload,
} from "./utils/channelPermissions";
export type { TriState } from "./utils/channelPermissions";
export { EditDescriptionModal } from "./components/channels/EditDescriptionModal";
export { ChannelPermissionsTab } from "./components/channels/ChannelPermissionsTab";
export type { ChannelPermissionsTabActions } from "./components/channels/ChannelPermissionsTab";
export { ChannelBansTab } from "./components/channels/ChannelBansTab";
export type { ChannelBansTabActions, ChannelBanRow, ChannelBansTabUser } from "./components/channels/ChannelBansTab";
export { ChannelTalkPowerTab } from "./components/channels/ChannelTalkPowerTab";
export type { ChannelTalkPowerTabActions } from "./components/channels/ChannelTalkPowerTab";
export { ChannelSettingsModal, BANNER_MAX_BYTES, BANNER_MIME_TYPES } from "./components/channels/ChannelSettingsModal";
export type { ChannelSettingsModalChannel, ChannelSettingsSaveFields, BannerSource } from "./components/channels/ChannelSettingsModal";

// ---------------------------------------------------------------------------
// ChannelSidebar (parity hoist, 2026-07-20)
// ---------------------------------------------------------------------------
export { ChannelSidebar, categoryHasVisibleChannel } from "./components/layout/ChannelSidebar";
export {
  INDENT_CAP,
  STEP,
  DRILL_DEPTH,
  computeIndent,
  resolveDrillInScope,
  flattenAllianceChannels,
  allianceChannelIcon,
  computeDragIntent,
} from "./components/layout/channelSidebarLayout";
export type { IndentInfo, DrillInScope, AllianceFlatNode, DragIntent, DragRect } from "./components/layout/channelSidebarLayout";
export { WhisperPanel } from "./components/voice/WhisperPanel";
export { WhisperInbox } from "./components/voice/WhisperInbox";
export type { WhisperInboxEntry } from "./components/voice/WhisperInbox";
export { SoundboardPopover } from "./components/voice/SoundboardPopover";
export {
  isSpawnerChannel,
  resolveOwnerDisplayName,
} from "./utils/spawnerChannels";
export { moveChannelOptions, decideVoiceMove } from "./utils/voiceMove";
export type { VoiceMovePush, VoiceMoveDecision } from "./utils/voiceMove";

// ---------------------------------------------------------------------------
// HubAdminPage (parity hoist, 2026-07-20)
// ---------------------------------------------------------------------------
export { HubAdminPage } from "./components/admin/HubAdminPage";
export type { HubAdminTab, HubAdminPageProps } from "./components/admin/HubAdminPage";
export { RolesSection, ALL_PERMISSIONS } from "./components/admin/RolesSection";
export type { RolesSectionActions, RoleUpdateInput } from "./components/admin/RolesSection";
export { MemberRoleManager } from "./components/admin/MemberRoleManager";
export type { MemberRoleManagerActions } from "./components/admin/MemberRoleManager";
export { RoleCategoryManager } from "./components/admin/RoleCategoryManager";
export type { RoleCategoryManagerActions } from "./components/admin/RoleCategoryManager";
export { ColorSwatchPicker } from "./components/admin/ColorSwatchPicker";
export { ServerTagsSection } from "./components/admin/ServerTagsSection";
export type { ServerTagsSectionActions } from "./components/admin/ServerTagsSection";
export { InviteManager } from "./components/admin/InviteManager";
export type { InviteManagerActions } from "./components/admin/InviteManager";
export { AuditLogSection } from "./components/admin/AuditLogSection";
export type { AuditLogSectionActions } from "./components/admin/AuditLogSection";
export { CertificationsSection } from "./components/admin/CertificationsSection";
export type { CertificationsSectionActions } from "./components/admin/CertificationsSection";

// ---------------------------------------------------------------------------
// Settings: ProfileTab / ProfileEditorSection + TABS skeleton (settings-ia.md
// parity hoist, 2026-07-20)
// ---------------------------------------------------------------------------
export { ProfileTab } from "./components/settings/ProfileTab";
export { ProfileEditorSection } from "./components/settings/ProfileEditorSection";
export { MyCertificationsSection } from "./components/settings/MyCertificationsSection";
export { TrustedIssuersSection } from "./components/settings/TrustedIssuersSection";
export {
  parseTrustRoots,
  serializeTrustRoots,
  addTrustRoot,
  removeTrustRoot,
  isTrustedIssuer,
  normalizePubkey,
} from "./utils/trustRoots";
export type { TrustRoot } from "./utils/trustRoots";
export { FavoriteHubsEditor } from "./components/settings/FavoriteHubsEditor";
export { AvatarChooser } from "./components/settings/AvatarChooser";
export type {
  ProfileAccountRef,
  ProfileDraftFields,
  HubProfileSnapshot,
  ProfileEditorActions,
  MyCertification,
  PerAccountProps,
} from "./types";
export { resolveManagingAccount } from "./utils/resolveManagingAccount";
export { loadHiddenBadgeSet, saveHiddenBadgeSet } from "./utils/hiddenBadges";
export { SettingsShell } from "./components/settings/SettingsShell";
export type { SettingsTabDef } from "./components/settings/SettingsShell";
export { HelpTab } from "./components/settings/HelpTab";
export { SoundboardAdminSection } from "./components/admin/SoundboardAdminSection";
export type { SoundboardAdminSectionActions } from "./components/admin/SoundboardAdminSection";
export { OnboardingAdminSection } from "./components/admin/OnboardingAdminSection";
export type { OnboardingAdminSectionActions } from "./components/admin/OnboardingAdminSection";
export { ChallengePreviewModal } from "./components/admin/ChallengePreviewModal";
export type {
  PendingUser,
  MemberAdminInfo,
  BanInfo,
  InviteInfo,
  HubSelfTagSettings,
  HubBadge,
  PendingBadgeOffer,
  SoundboardClip,
  AuditLogEntry,
  AuditLogPage,
  CertIssuance,
  CertAdmissionSettings,
  ChallengeMode,
  ChallengeDifficulty,
  RecoveryContactItem,
  RecoveryAdminRequest,
  RecoveryRequestBundle,
} from "./types";
export { RecoveryContactsSection } from "./components/settings/RecoveryContactsSection";
export type { RecoveryContactsSectionActions } from "./components/settings/RecoveryContactsSection";

// Shared app-orchestration hooks (used by both web and desktop App.tsx).
export { useVoiceMoveUx } from "./hooks/useVoiceMoveUx";
export type { VoiceMoveMenuState } from "./hooks/useVoiceMoveUx";
export { RemoveHubModal } from "./components/RemoveHubModal";
export { EncryptionWarningModal } from "./components/EncryptionWarningModal";
export { ContentReportsSection } from "./components/admin/ContentReportsSection";
export { AutomodWebhookSection } from "./components/admin/AutomodWebhookSection";
export { FederatedBanlistSection } from "./components/admin/FederatedBanlistSection";
export type { FederatedBanlistActions } from "./components/admin/FederatedBanlistSection";
export type { AutomodWebhookActions } from "./components/admin/AutomodWebhookSection";
export type { ContentReportsActions } from "./components/admin/ContentReportsSection";
export type { EncryptionWarning } from "./components/EncryptionWarningModal";
export { homeHubStatus } from "./utils/homeHubStatus";
export { resolveStoredPresence, storedPresenceFor } from "./utils/presenceExpiry";
export type { StoredPresence } from "./utils/presenceExpiry";
export type { HomeHubStatus } from "./utils/homeHubStatus";
export { useUnreadCounts } from "./hooks/useUnreadCounts";
export { useWhisper } from "./hooks/useWhisper";
export { useTypingIndicators, typingKey, typingForScope } from "./hooks/useTypingIndicators";
export type { TypingDeps, TypingMap } from "./hooks/useTypingIndicators";
export type { WhisperDeps, WhisperParams } from "./hooks/useWhisper";
export type { UnreadCounts, UnreadCountsDeps } from "./hooks/useUnreadCounts";
export { usePresenceStatus } from "./hooks/usePresenceStatus";
export { useHubSetupWizardGate } from "./hooks/useHubSetupWizardGate";
export { useSoundboardChips, parseSoundboardPlayedEvent } from "./hooks/useSoundboardChips";
export type { SoundboardPlayedEvent } from "./hooks/useSoundboardChips";
export { useWhisperKeybinds } from "./hooks/useWhisperKeybinds";
export { useAlliances } from "./hooks/useAlliances";
export type { AllianceDeps, AlliancesReturn, SelectedAllianceChannel } from "./hooks/useAlliances";
export { applyWhisperLogEvent, pickReplyPubkey } from "./utils/whisperInbox";
export type { InboundWhisperEntry } from "./utils/whisperInbox";
export { ChannelContextMenu } from "./components/channels/ChannelContextMenu";
export type { ChannelContextMenuProps } from "./components/channels/ChannelContextMenu";
