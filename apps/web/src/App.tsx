import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useUnreadCounts } from "@wavvon/ui";
import { useNotificationPrefs } from "./hooks/useNotificationPrefs";
import { useRemoveHubConfirm } from "./hooks/useRemoveHubConfirm";
import { useTypingIndicators } from "./hooks/useTypingIndicators";

import { useHubConnection } from "./hooks/useHubConnection";
import { useHubAdmin } from "./hooks/useHubAdmin";
import { useAlliances } from "./hooks/useAlliances";
import { useSettingsProfile } from "./hooks/useSettingsProfile";
import { useWhisper } from "./hooks/useWhisper";
import { pickReplyPubkey, useWhisperKeybinds } from "@wavvon/ui";
import { useScreenShare } from "./hooks/useScreenShare";
import { useDms } from "./hooks/useDms";
import { useVoice } from "./hooks/useVoice";
import type { VoiceExtDeps } from "./hooks/useVoice";
import { useVideo } from "./hooks/useVideo";
import { useWsHandlers } from "./hooks/useWsHandlers";
import { useAddHubFlow } from "./hooks/useAddHubFlow";
import { useChannelCrud } from "./hooks/useChannelCrud";
import { useHubLifecycle } from "./hooks/useHubLifecycle";
import { useChannelMessages } from "./hooks/useChannelMessages";
import { useAppKeybinds } from "./hooks/useAppKeybinds";
import { loadWhisperReplyBind, saveWhisperReplyBind } from "./utils/whisperReply";
import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { flattenTree, descendantIds, computeDepth, channelPath, inviteCodeFromPath } from "@wavvon/core";
import { getScoped, setScoped } from "./utils/accountScope";
import { DISCOVERY_URL, MULTI_HUB } from "./constants";
import { handoffTargetUrl } from "./utils/handoffTarget";
import type {
  Channel,
  User,
  VoiceParticipant,
  Hub,
  MeInfo,
  Conversation,
} from "@shared/types";
import type { BotAppLaunchEvent, BotAppOpenEvent } from "./types";
import { HubSidebar } from "@wavvon/ui";
import { useSoundboardChips } from "@wavvon/ui";
import { WhisperInbox } from "@wavvon/ui";
import { ContentArea } from "@components/layout/ContentArea";
import { ChannelSidebarContainer } from "@components/layout/ChannelSidebarContainer";
import { AppModals } from "@components/layout/AppModals";
import { isIdentityBackedUp, wasBackupPrompted, markBackupPrompted } from "./utils/identityBackup";
import { loadDefaultProfile, saveDefaultProfile, type DefaultProfile } from "./utils/profiles";
import { startPrefsSync } from "./utils/prefsSync";
import { listRoles, listUserRoles, assignRoleToUser, removeRoleFromUser, createInvite } from "@platform";
import {
  listHubIcons,
  forumListTags, forumCreateTag, forumEditTag, forumDeleteTag,
} from "@platform";
import type { UserContextMenuActions, WhisperTarget, WhisperReplyBind } from "@wavvon/ui";
import { getCurrentSurvey, isLobbyScopeConfined, connectHubWebSocket, fetchAllUsers } from "@platform";
import { fetchMemberHistory } from "@platform";
import { SurveyModal } from "@components/polls/SurveyModal";
import { HubStreamsPanel } from "@wavvon/ui";
import { AddHubModal } from "@wavvon/ui";
import { passkeysUsableWith } from "@platform";
import { QuickInviteModal } from "@wavvon/ui";
import { ChannelSettingsModal } from "@wavvon/ui";
import { EditDescriptionModal } from "@wavvon/ui";
import { BotAppLaunchCard, EventComposer, PollComposer, FocusTrap, GameModal, KeyboardShortcuts, ChannelContextMenu, VoiceMoveMenu, VoiceMoveToast, VoiceMovePromptModal, SearchBar, DiscoverPage, Lobby, HubSetupWizard } from "@wavvon/ui";
import { createEvent, createPoll } from "@platform";
import { moveChannelOptions, computeDragIntent } from "@wavvon/ui";
import { useVoiceMoveUx, usePresenceStatus, useHubSetupWizardGate } from "@wavvon/ui";
import { HubAdminContainer } from "@components/admin/HubAdminContainer";
import {
  channelPermissionsTabActions, channelBansTabActions, channelTalkPowerTabActions,
} from "./platform/adminActions";
import { WelcomeScreenContainer } from "@components/layout/WelcomeScreen";
import { SettingsPageContainer } from "@components/settings/SettingsPageContainer";
import { UserContextMenu } from "@wavvon/ui";
import { VideoPipWindow } from "@components/voice/VideoPipWindow";
import { FriendsModal } from "@wavvon/ui";
import { listFriends, listPendingFriendRequests, sendFriendRequest, acceptFriendRequest, removeFriend } from "@platform";
import { MobileShell } from "@wavvon/ui";
import { buildChannelTree } from "@wavvon/core";
import type { TreeNode } from "@wavvon/core";
import { ScreenShareSelfPreview } from "@components/voice/ScreenShareSelfPreview";
import { listBotCommands, updateDmBlocks, getDmBlocks, fetchVoiceRoster, activeSession, sendBotAppJoin, listConversations } from "@platform";
import { sendSetStatus } from "@platform";
import {
  restorePersistedHubs,
  listHubs,
  refreshHubInfo,
  hubFetch,
  HubApiError,
  loadSavedHubs,
  fetchWithTimeout,
  getLobbyStatus,
  getLobbyWelcome,
  submitLobbyPow,
} from "@platform";
import { getActiveHubId, redeemInvite } from "@platform";
import {
  getMessages,
  getUnreadCounts,
  subscribeChannel,
} from "@platform";
import {
  publishDhKey,
} from "@platform";
import { loadIdentity, publicKeyHex, setSwitchGuard } from "@identity/index";
import { IdentitySetupScreen, type IdentitySetupCompletion } from "@components/identity/IdentitySetupScreen";
import type { HubInputResult } from "@wavvon/core";

// ---- Types ----
type View = "channels" | "dms";

// ---- App ----

export interface AppProps {
  // Set by AccountRoot right after an in-place account switch initiated from
  // Settings → Account, so the user lands back there on the new account
  // instead of the main view.
  initialView?: "settings-account";
}

export default function App({ initialView }: AppProps = {}) {
  const { t } = useTranslation();
  // === Identity ===
  const [ready, setReady] = useState<"checking" | "setup" | "ok">("checking");
  const [publicKey, setPublicKey] = useState<string | null>(null);

  // An identity created from an invite link never met the phrase screen, so
  // the only copy of its key is this browser's. That fact gets a marker on the
  // settings gear until it stops being true, and one prompt at the first
  // message — see utils/identityBackup.ts. Recomputed rather than watched:
  // the two places that can change it are the settings panel and this prompt,
  // and both close.
  const [identityNeedsBackup, setIdentityNeedsBackup] = useState(false);
  const [showBackupPrompt, setShowBackupPrompt] = useState(false);
  function refreshIdentityBackupState() {
    setIdentityNeedsBackup(!isIdentityBackedUp());
  }
  function handleOwnMessageSent() {
    if (isIdentityBackedUp() || wasBackupPrompted()) return;
    markBackupPrompted();
    setShowBackupPrompt(true);
  }

  // Captured wholesale (not just destructured) so it can be passed straight
  // through to SettingsPageContainer/ChannelSidebarContainer as one grouped
  // prop (state-access-design.md Phase 1) — App still pulls out the handful
  // of fields it needs directly (useAppKeybinds, the mention-ping ref).
  const settingsProfile = useSettingsProfile(setPublicKey, initialView);
  const { showSettings, setShowSettings, mentionPingEnabled } = settingsProfile;

  // Closing the settings panel is when revealing the phrase or exporting a
  // backup could have happened, and a fresh identity is the other moment the
  // answer changes.
  useEffect(() => {
    refreshIdentityBackupState();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey, showSettings]);

  // === Hubs ===
  const hubLifecycle = useHubLifecycle({ loadHubData, resetChannelSelectionState, goToChannelsView });
  const {
    hubs, setHubs,
    activeHubId, setActiveHubIdState,
    activeHubTimezone, setActiveHubTimezone,
    pingByHub,
    lobbyHubs, setLobbyHubs,
    pendingApprovalHubs, setPendingApprovalHubs,
    handleHubReorder,
    handleSwitchHub,
    handleRemoveHub,
  } = hubLifecycle;
  // Removing a hub is local and reversible, but a removed *home* hub keeps
  // receiving this user's DMs — so the sidebar asks first rather than acting
  // (decisions.md, "Leave hub does not leave").
  const removeHubConfirm = useRemoveHubConfirm(handleRemoveHub);
  const hubConnection = useHubConnection();
  const { hubConnected, reconnectingHubs, handleStatusChange } = hubConnection;
  const [assertiveAnnouncement, setAssertiveAnnouncement] = useState("");
  const [voicePoliteAnnouncement, setVoicePoliteAnnouncement] = useState("");
  const voiceAnnounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingVoiceAnnouncementsRef = useRef<string[]>([]);
  const [showQuickInvite, setShowQuickInvite] = useState(false);
  const [homeHubUrl, setHomeHubUrl] = useState<string | undefined>(undefined);
  const [channelCtxMenu, setChannelCtxMenu] = useState<{ channel: Channel; x: number; y: number } | null>(null);
  // "Create event"/"create poll" from the channel context menu (create-anything
  // task): both composers are self-contained modals that only need a target
  // channel id, so they can be opened without switching to that channel first.
  const [eventComposerChannelId, setEventComposerChannelId] = useState<string | null>(null);
  const [pollComposerChannelId, setPollComposerChannelId] = useState<string | null>(null);

  // === Hub data ===
  const [channels, setChannels] = useState<Channel[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [meInfo, setMeInfo] = useState<MeInfo | null>(null);
  const [slashCommands, setSlashCommands] = useState<Array<{ command: string; description: string; bot_name: string }>>([]);
  const alliances = useAlliances(showHubError);
  const {
    userAlliances, setUserAlliances, allianceChannels, setAllianceChannels,
    selectedAllianceChannel, allianceMessages, loadAlliances,
    selectAllianceChannel, clearSelectedAllianceChannel, sendAllianceMessage,
  } = alliances;

  // === View ===
  const [view, setView] = useState<View>("channels");

  // === Unread / notifications ===
  const unreadCounts = useUnreadCounts();
  const {
    unreadByChannel, unreadByHub, unreadDms, setUnreadDms,
    bumpUnread, clearUnread, seedUnreadFromServer,
  } = unreadCounts;

  // === Messages ===
  // App-side navigation when a channel/alliance channel is selected — one of
  // the two directions between this hook and useDms has to be a callback
  // defined here, since each needs the other's setter.
  function clearConversationSelection() { setSelectedConversation(null); }
  const channelMessages = useChannelMessages({
    activeHubId,
    setView,
    clearConversationSelection,
    clearUnread,
    selectedAllianceChannel,
    clearSelectedAllianceChannel,
    selectAllianceChannel,
    sendAllianceMessage,
    onMessageSent: handleOwnMessageSent,
  });
  const {
    selectedChannel, setSelectedChannel, selectedChannelRef, selectedChannelIdRef,
    messages, setMessages,
    inputText, setInputText,
    editingMessageId, setEditingMessageId,
    editingDraft, setEditingDraft,
    replyTarget, setReplyTarget,
    pendingAttachments, setPendingAttachments,
    stickToBottom, setStickToBottom,
    newWhileScrolledUp, setNewWhileScrolledUp,
    searchOpen, setSearchOpen,
    searchQuery, setSearchQuery,
    searchResults, setSearchResults,
    firstNotifyingMessageId, setFirstNotifyingMessageId,
    pendingScrollMessageId, setPendingScrollMessageId,
    messagesEndRef, messagesEndChannelRef, messagesContainerRef, messageInputRef,
    handleScrollToMessage,
    handleSelectChannel,
    handleSelectAllianceChannel,
    handleSendAllianceMessage,
    handleSend,
    handleSaveEdit,
    handleCancelEdit,
    handleStartEdit,
    handleDeleteMessage,
    handleToggleReaction,
    handleKeyDown,
    handleJumpToBottom,
    handleMessagesScroll,
    handleInputTextChange,
    handleCloseSearch,
  } = channelMessages;
  const [memberSidebarHidden, setMemberSidebarHidden] = useState(false);

  // Reset shared by useHubLifecycle's handleSwitchHub (clearMessages=true) and
  // handleRemoveHub (clearMessages=false). Defined as a function declaration
  // (hoisted) so useHubLifecycle can be called before useChannelMessages,
  // useDms, and useAlliances exist — its body only runs later, once all three
  // are initialized.
  function resetChannelSelectionState(clearMessages: boolean) {
    setSelectedChannel(null);
    clearConversationSelection();
    clearSelectedAllianceChannel();
    setUserAlliances([]);
    setAllianceChannels({});
    if (clearMessages) setMessages([]);
  }
  function goToChannelsView() { setView("channels"); }

  // === DMs ===
  const dms = useDms({
    inputText,
    setInputText,
    setUnreadDms,
    onConversationSelected: () => { setSelectedChannel(null); setView("dms"); },
    showHubError,
  });
  const {
    conversations, setConversations, dmMessages,
    selectedConversation, setSelectedConversation, selectedConvRef,
    handleSelectConversation, handleStartConversation, handleSendDm,
    onDm, onDmMemberChanged,
  } = dms;
  const notifyPrefs = useNotificationPrefs();
  const {
    hubNotifyMode, channelNotifyMode, pinnedChannels, collapsedCategories, hideSilenced,
    hideBirthdays, toggleHideBirthdays,
    setHubNotifyMode, setChannelNotifyMode, setCollapsedCategories, toggleHideSilenced, effectiveNotifyMode,
  } = notifyPrefs;
  const silencedChannelIds = useMemo(() => {
    if (!activeHubId) return new Set<string>();
    return new Set(
      channels
        .filter((c) => !c.is_category && effectiveNotifyMode(activeHubId, c.id) === "silent")
        .map((c) => c.id),
    );
  }, [channels, activeHubId, effectiveNotifyMode]);
  const pubkeyToName = useMemo(() => {
    const m: Record<string, string | null> = {};
    for (const u of users) m[u.public_key] = u.display_name ?? null;
    return m;
  }, [users]);
  const [blockedUsers, setBlockedUsers] = useState<Set<string>>(new Set());
  const [ignoredUsers, setIgnoredUsers] = useState<Set<string>>(() => {
    try {
      const raw = getScoped("wavvon.ignoredUsers");
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch { return new Set(); }
  });

  function toggleBlockUser(pubkey: string) {
    const prev = blockedUsers;
    const next = new Set(prev);
    if (next.has(pubkey)) next.delete(pubkey);
    else next.add(pubkey);
    setBlockedUsers(next);
    // Optimistic update; on failure revert and say so — a silently
    // unpersisted block is a safety problem, not a cosmetic one.
    updateDmBlocks(Array.from(next)).catch((e) => {
      setBlockedUsers(prev);
      showHubError(e instanceof HubApiError ? e.message : String(e));
    });
  }

  function toggleIgnoreUser(pubkey: string) {
    setIgnoredUsers((prev) => {
      const next = new Set(prev);
      if (next.has(pubkey)) next.delete(pubkey);
      else next.add(pubkey);
      try { setScoped("wavvon.ignoredUsers", JSON.stringify(Array.from(next))); } catch {}
      return next;
    });
  }
  // === Hub admin ===
  const hubAdminState = useHubAdmin({
    activeHubId,
    // The sidebar renders the locally-stored hub list, whose hub_name/hub_icon
    // are written at add-time — sync them or a rename/icon change never shows
    // up there.
    onSaved: () => {
      if (!activeHubId) return;
      refreshHubInfo(activeHubId).then((info) => {
        if (info) setHubs(listHubs());
      }).catch(() => {});
    },
  });
  const {
    showHubAdmin, setShowHubAdmin,
    hubAdminTab, setHubAdminTab,
    maxChannelDepth,
    openHubAdmin,
  } = hubAdminState;

  // === Profile on the active hub (community-axis; the hub is the source of
  // truth, PATCH /me writes it). The per-account default profile is read from
  // scoped storage at use time — no App state to go stale.
  async function handleUpdateHubProfile(profile: DefaultProfile) {
    try {
      await hubFetch("/me", {
        method: "PATCH",
        body: JSON.stringify({
          display_name: profile.display_name,
          avatar: profile.avatar ?? "",
          bio: profile.bio ?? "",
          pronouns: profile.pronouns ?? "",
          status_message: profile.status_message ?? "",
          activities: profile.activities ?? "",
          accent_color: profile.accent_color ?? "",
          name_color: profile.name_color ?? "",
          cover: profile.cover ?? "",
          favorite_hubs: profile.favorite_hubs,
          show_hubs: profile.show_hubs,
          birthday: profile.birthday ?? "",
        }),
      });
      hubFetch("/me").then((r) => r.json() as Promise<MeInfo>).then(setMeInfo).catch(() => {});
      fetchAllUsers().then(setUsers).catch(() => {});
    } catch (e) {
      showHubError(e instanceof HubApiError ? e.message : String(e));
    }
  }

  // The settings profile editor PATCHes any hub itself (via that hub's own
  // session); App only needs to refresh its active-hub mirrors afterwards.
  function handleHubProfileSaved(hubId: string) {
    if (hubId !== activeHubId) return;
    hubFetch("/me").then((r) => r.json() as Promise<MeInfo>).then(setMeInfo).catch(() => {});
    fetchAllUsers().then(setUsers).catch(() => {});
  }

  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);

  // === New web-only UI state ===
  const [showDiscover, setShowDiscover] = useState(false);
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [showDisplayNamePrompt, setShowDisplayNamePrompt] = useState(false);
  const [userContextMenu, setUserContextMenu] = useState<{
    user: User;
    position: { x: number; y: number };
  } | null>(null);

  // === Refs mirrored for WS handlers / voice (created early so the voice
  // cluster below, and useWsHandlers further down, can read them) ===
  const publicKeyRef = useRef<string | null>(publicKey);
  publicKeyRef.current = publicKey;
  const meInfoRef = useRef<MeInfo | null>(null);
  useEffect(() => { meInfoRef.current = meInfo; }, [meInfo]);
  const mentionPingEnabledRef = useRef(mentionPingEnabled);
  mentionPingEnabledRef.current = mentionPingEnabled;
  const effectiveNotifyModeRef = useRef(effectiveNotifyMode);
  effectiveNotifyModeRef.current = effectiveNotifyMode;

  // === Presence (own status, shared across every hub this account is on) ===
  const presence = usePresenceStatus({
    loadRaw: () => getScoped("wavvon.presence"),
    persist: (p) => { try { setScoped("wavvon.presence", JSON.stringify(p)); } catch { /* storage unavailable */ } },
    broadcast: (s) => { try { sendSetStatus(s, null); } catch { /* ws not ready */ } },
    // Optimistic: the hubs' member_status broadcasts will confirm. Invisible
    // shows the user offline (to everyone, incl. their own roster view); the
    // footer picker still reflects "invisible".
    applyToRoster: (s) => {
      setUsers((prev) => prev.map((u) =>
        u.public_key === publicKey
          ? { ...u, online: s !== "invisible", status: s === "online" || s === "invisible" ? null : s, status_custom: null }
          : u,
      ));
    },
  });
  const { myPresence, myPresenceRef, handleSetStatus } = presence;

  // === Voice / video / whisper / voice-move UX ===
  // The hubFetch("/channels") -> setChannels resync used when a spawner join
  // lands in a sibling room not yet in the local channel list.
  function refetchChannels() {
    hubFetch("/channels").then((r) => r.json() as Promise<Channel[]>).then(setChannels).catch(() => {});
  }
  // Filled in below once useVideo/useWhisper/useVoiceMoveUx exist. useVoice
  // only ever reads extRef.current at call time (async), so it's safe for
  // this to start out as no-ops and be overwritten later in the same render.
  const voiceExtRef = useRef<VoiceExtDeps>({
    createVideoSession: () => {},
    disposeVideo: () => {},
    stopVideoSessionOnly: () => {},
    stopWhisperIfActive: () => {},
    setVoiceChannelNameHint: () => {},
    clearVoiceChannelNameHint: () => {},
  });
  const voice = useVoice({
    publicKey, publicKeyRef, meInfoRef, showHubError, refetchChannels, extRef: voiceExtRef,
  });
  const video = useVideo({ voiceChannelId: voice.voiceChannelId, showHubError, publicKeyRef });
  const voiceMoveUx = useVoiceMoveUx({ joinVoice: voice.handleVoiceJoin });
  const whisper = useWhisper({ activeHubId, voiceChannelId: voice.voiceChannelId });
  voiceExtRef.current = {
    createVideoSession: video.createVideoSession,
    disposeVideo: video.disposeVideo,
    stopVideoSessionOnly: video.stopVideoSessionOnly,
    stopWhisperIfActive: () => { if (whisper.isWhispering) whisper.stopWhisper(); },
    setVoiceChannelNameHint: (name) => voiceMoveUx.setVoiceChannelNameHint(name),
    clearVoiceChannelNameHint: () => voiceMoveUx.setVoiceChannelNameHint(null),
  };
  const whisperOptoutRef = useRef(whisper.whisperOptout);
  whisperOptoutRef.current = whisper.whisperOptout;
  const [whisperReplyBind, setWhisperReplyBindState] = useState<WhisperReplyBind>(loadWhisperReplyBind);
  const setWhisperReplyBind = (bind: WhisperReplyBind) => {
    setWhisperReplyBindState(bind);
    saveWhisperReplyBind(bind);
  };
  // Reply key target: the most recent inbound whisperer (see pickReplyPubkey).
  const whisperReplyTarget = useMemo<WhisperTarget | null>(() => {
    const pk = pickReplyPubkey(whisper.inboundWhisperLog);
    if (!pk) return null;
    const name = users.find((u) => u.public_key === pk)?.display_name;
    return { type: "user", id: pk, label: name || pk.slice(0, 8) };
  }, [whisper.inboundWhisperLog, users]);
  useWhisperKeybinds({
    voiceChannelId: voice.voiceChannelId,
    whisperLists: whisper.whisperLists,
    isWhispering: whisper.isWhispering,
    startWhisper: whisper.startWhisper,
    stopWhisper: whisper.stopWhisper,
    replyBind: whisperReplyBind,
    replyTarget: whisperReplyTarget,
  });
  const [surveyToShow, setSurveyToShow] = useState<import("@platform").SurveyAdmin | null>(null);
  const surveyDismissedRef = useRef<Set<string>>(new Set());
  // Registered so switchAccount can refuse a mid-voice switch at the source
  // (defense in depth alongside the disabled Switch button in Settings →
  // Account) — switching accounts while joined to a voice channel is blocked
  // outright, not auto-left on the caller's behalf.
  useEffect(() => {
    setSwitchGuard(() => (voice.voiceChannelId ? t("settings.account.accounts.switch_blocked_voice") : null));
    return () => setSwitchGuard(null);
  }, [voice.voiceChannelId, t]);

  const [activeBotApps, setActiveBotApps] = useState<Map<string, BotAppLaunchEvent>>(new Map());
  const [activeOpenApp, setActiveOpenApp] = useState<{ event: BotAppOpenEvent; hubUrl: string } | null>(null);

  const loadingHub = useRef(false);

  // === Identity init ===

  useEffect(() => {
    loadIdentity().then((rec) => {
      if (rec) {
        setPublicKey(rec.canonical_pubkey ?? publicKeyHex(rec.seed_hex));
        setReady("ok");
      } else {
        setReady("setup");
      }
    });
  }, []);

  function handleIdentityComplete(result: IdentitySetupCompletion) {
    // Nickname + avatar chosen during onboarding become the default profile,
    // which the first-hub effect below applies automatically via PATCH /me.
    if (result.profile) saveDefaultProfile({ display_name: result.profile.display_name, avatar: result.profile.avatar, bio: null, pronouns: null, status_message: null, activities: null, accent_color: null, name_color: null, cover: null, favorite_hubs: [], show_hubs: false, birthday: null });
    loadIdentity().then((rec) => {
      if (rec) setPublicKey(rec.canonical_pubkey ?? publicKeyHex(rec.seed_hex));
      setReady("ok");
    });
  }

  // === Typing ===
  const selectedConvIdRef = useRef<string | undefined>(undefined);
  const typingIndicators = useTypingIndicators(
    () => selectedChannelIdRef.current,
    () => selectedConvIdRef.current,
    () => publicKeyRef.current,
  );
  const { receiveTyping, pingTyping, pingDmTyping } = typingIndicators;
  const { chipsByChannel: soundboardChipsByChannel, receiveSoundboardPlayed } = useSoundboardChips();

  // === Refs ===
  const [showFriends, setShowFriends] = useState(false);

  // === WS handlers (stable via ref) ===

  const activeHubIdRef = useRef<string | null>(null);
  useEffect(() => { activeHubIdRef.current = activeHubId; }, [activeHubId]);

  // Outbound screen share + cross-channel hub-streams discovery.
  const screenShare = useScreenShare({ activeHubIdRef, showHubError });
  const {
    screenShareViewerRef, activeScreenShares, sharing, shareKbps, shareLocalStream,
    hubStreams, showHubStreams, setShowHubStreams, subscribedStreamIds,
    handleStartShare, handleStopShare, handleOpenHubStreams, handleWatchStream,
    handleStopWatchStream, onScreenShare, onScreenShareChunk,
  } = screenShare;

  const hubsRef = useRef<Hub[]>([]);
  const channelsRef = useRef<Channel[]>([]);
  useEffect(() => { channelsRef.current = channels; }, [channels]);
  useEffect(() => { hubsRef.current = hubs; }, [hubs]);

  // An identity restored from a .wavvon-backup never went through onboarding,
  // so it has no local default profile even though the hub already holds the
  // real one -- the profile editor opened on an empty card (placeholder name,
  // no avatar) for a user the hub knows perfectly well. Seed the default from
  // the hub member state the first time we see it; the guard means a real
  // default is never overwritten.
  // ponytail: first hub to load wins if several are joined -- fine for a
  // restore, revisit if per-hub profiles ever diverge before the seed.
  useEffect(() => {
    if (!meInfo?.display_name) return;
    if (loadDefaultProfile()) return;
    saveDefaultProfile({
      display_name: meInfo.display_name,
      avatar: meInfo.avatar,
      bio: meInfo.bio,
      pronouns: meInfo.pronouns,
      status_message: meInfo.status_message,
      activities: meInfo.activities,
      accent_color: meInfo.accent_color,
      name_color: meInfo.name_color,
      cover: meInfo.cover,
      favorite_hubs: meInfo.favorite_hubs,
      show_hubs: meInfo.show_hubs,
      birthday: meInfo.birthday,
    });
  }, [meInfo]);

  useEffect(() => {
    if (hubs.length === 1 && meInfo !== null && !meInfo.display_name) {
      // A default profile means the user already told us who they want to
      // be — apply it silently instead of asking again. Read at fire time so
      // edits made in Settings since mount are honored.
      const def = loadDefaultProfile();
      if (def) {
        void handleUpdateHubProfile(def);
      } else {
        setShowDisplayNamePrompt(true);
      }
    }
  // Only fire once when meInfo first loads on the first hub
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meInfo?.display_name, hubs.length]);

  useEffect(() => {
    selectedConvIdRef.current = selectedConversation?.id;
  }, [selectedConversation]);

  // Toast state for hub error messages (W6)
  const [hubErrorToast, setHubErrorToast] = useState<string | null>(null);
  const hubErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showHubError(msg: string) {
    if (hubErrorTimerRef.current) clearTimeout(hubErrorTimerRef.current);
    setHubErrorToast(msg);
    hubErrorTimerRef.current = setTimeout(() => setHubErrorToast(null), 5000);
  }

  const loadHubDataRef = useRef<() => Promise<void>>(async () => {});
  loadHubDataRef.current = loadHubData;

  const { stableHandlers, stableHandlersRef } = useWsHandlers({
    activeHubIdRef, hubsRef, selectedChannelRef, meInfoRef, publicKeyRef,
    myPresenceRef, effectiveNotifyModeRef, mentionPingEnabledRef, whisperOptoutRef,
    setMessages, setStickToBottom, setNewWhileScrolledUp, bumpUnread,
    setUsers, setChannels, setHubs, setActiveHubTimezone,
    setVoicePartByChannel: voice.setVoicePartByChannel,
    onDm, onDmMemberChanged, receiveTyping,
    onScreenShare, onScreenShareChunk, receiveSoundboardPlayed,
    handleStatusChange, setAssertiveAnnouncement, showHubError,
    loadHubDataRef,
    voiceOnVoiceState: voice.onVoiceState,
    voiceOnVoiceZoneState: voice.onVoiceZoneState,
    voiceOnVoiceZoneCreated: voice.onVoiceZoneCreated,
    voiceOnVoiceZoneDestroyed: voice.onVoiceZoneDestroyed,
    voiceOnVoicePositionUpdated: voice.onVoicePositionUpdated,
    voiceOnVoiceKeyReceived: voice.onVoiceKeyReceived,
    voiceOnVoiceKeyRequest: voice.onVoiceKeyRequest,
    handleVideoMessage: video.handleVideoMessage,
    receiveWhisperEvent: whisper.receiveWhisperEvent,
    onVoiceMovePush: voiceMoveUx.onVoiceMovePush,
    setActiveBotApps, setActiveOpenApp,
  });

  // === Hub restore on startup ===

  // One reload per page load is enough to let pulled boot-time settings
  // (language, theme) take hold; the flag lives in sessionStorage so a
  // reload loop is impossible even if a pull somehow keeps reporting changes.
  const PREFS_RELOAD_FLAG = "wavvon.prefsReloaded";
  const [hubsRestored, setHubsRestored] = useState(false);
  const prefsSyncRef = useRef<Awaited<ReturnType<typeof startPrefsSync>>>(null);

  useEffect(() => {
    if (ready !== "ok") return;
    let cancelled = false;
    async function restore() {
      const list = await restorePersistedHubs(stableHandlers);
      setHubs(list);
      const id = getActiveHubId();
      if (id) {
        setActiveHubIdState(id);
        await loadHubData();
        publishDhKey().catch(() => {});
      }
      // The path-invite effect below needs "restored, and this is what we've
      // got" — hubs.length alone cannot tell that apart from "not yet run".
      setHubsRestored(true);
      const globalHomeHub = window.__WAVVON_HOME_HUB__;
      if (typeof globalHomeHub === "string" && globalHomeHub.trim() && loadSavedHubs().length === 0) {
        setHomeHubUrl(globalHomeHub.trim());
      }
      // Cross-device settings (docs/docs/home-hub.md "Prefs blob"). Started
      // here because it needs a hub to read and write through. Language and
      // theme are read once at boot, so a pull that actually changed
      // something only takes effect after a reload — done once per load, and
      // the steady state reports no change, so it cannot loop.
      // ponytail: a browser with no saved hub has nothing to sync through, so
      // this returns null and the first hub added in that session syncs
      // nothing — including the hub list it would have pulled back. It heals
      // on the next page load. Restart the sync on the 0->1 hub transition if
      // that first-run reload ever proves confusing.
      startPrefsSync(() => {
        if (!sessionStorage.getItem(PREFS_RELOAD_FLAG)) {
          sessionStorage.setItem(PREFS_RELOAD_FLAG, "1");
          window.location.reload();
        }
      })
        .then((handle) => {
          // An account switch can unmount before the pull resolves; without
          // this the poll would outlive the App that started it.
          if (cancelled) handle?.stop();
          else prefsSyncRef.current = handle;
        })
        .catch(() => { /* offline, or nothing published yet */ });
    }
    void restore();
    return () => {
      cancelled = true;
      prefsSyncRef.current?.stop();
      prefsSyncRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // === Hub data loading ===

  async function loadHubData() {
    if (loadingHub.current) return;
    loadingHub.current = true;
    // Self-heal the locally-cached hub name+icon (stored at add-time): a
    // rename or icon change done in hub admin — possibly on another device —
    // otherwise never reaches the sidebar, not even across reloads.
    // Fire-and-forget.
    {
      const hubId = getActiveHubId();
      if (hubId) {
        refreshHubInfo(hubId).then((info) => {
          if (info) {
            setHubs(listHubs());
            setActiveHubTimezone(info.timezone);
          }
        }).catch(() => { /* cosmetic sync only */ });
      }
    }
    try {
      const [ch, usr, me, convs, cmds, voiceRoster, dmBlocks] = await Promise.allSettled([
        hubFetch("/channels").then((r) => r.json() as Promise<Channel[]>),
        fetchAllUsers(),
        hubFetch("/me").then((r) => r.json() as Promise<MeInfo>),
        listConversations(),
        listBotCommands().catch(() => [] as Array<{ command: string; description: string; bot_name: string }>),
        fetchVoiceRoster().catch(() => ({} as Record<string, VoiceParticipant[]>)),
        getDmBlocks().catch(() => null),
      ]);
      // A lobby-scoped session (lobby-bot-survey.md Feature 1) 403s every
      // route outside the lobby allowlist — /channels is always in that
      // batch, so its rejection reason is the signal. Checked before
      // touching any other settled promise; the others 403 the same way and
      // there's nothing useful to salvage from them for a lobby hub.
      const hubIdForLobbyCheck = getActiveHubId();
      if (ch.status === "rejected" && isLobbyScopeConfined(ch.reason)) {
        if (hubIdForLobbyCheck) {
          setLobbyHubs((prev) => new Set([...prev, hubIdForLobbyCheck]));
        }
        // Drop whatever channel/user/conversation data is left over from a
        // previously active member hub — the lobby screen replaces the main
        // content area, but the persistent hub sidebar renders straight off
        // this state and would otherwise show a stale, unrelated hub's data.
        setChannels([]);
        setUsers([]);
        setConversations([]);
        setSelectedChannel(null);
        return;
      }
      if (hubIdForLobbyCheck) {
        setLobbyHubs((prev) => {
          if (!prev.has(hubIdForLobbyCheck)) return prev;
          const next = new Set(prev);
          next.delete(hubIdForLobbyCheck);
          return next;
        });
      }
      void loadAlliances();
      if (ch.status === "fulfilled") {
        setChannels(ch.value);
        if (!selectedChannelRef.current) {
          const first = ch.value.find((c) => !c.is_category && c.channel_type !== "banner" && c.channel_type !== "spawner");
          if (first) {
            setSelectedChannel(first);
            // Load the auto-selected channel's history + subscribe. Without
            // this the message pane stays empty after a hub switch (only
            // handleSelectChannel fetched messages, and switching bypasses it).
            subscribeChannel(first.id).catch(() => {});
            getMessages(first.id)
              .then((msgs) => {
                // Guard against a racing manual selection while we awaited.
                if (selectedChannelRef.current?.id === first.id) {
                  setMessages(msgs);
                  setStickToBottom(true);
                }
              })
              .catch(() => {});
          }
        }
      }
      if (usr.status === "fulfilled") setUsers(usr.value);
      if (me.status === "fulfilled") {
        const meVal = me.value;
        setMeInfo(meVal);
        const hubId = getActiveHubId();
        if (meVal.approval_status === "pending" && hubId) {
          setPendingApprovalHubs((prev) => new Set([...prev, hubId]));
          return;
        }
        if (hubId) {
          setPendingApprovalHubs((prev) => {
            if (!prev.has(hubId)) return prev;
            const next = new Set(prev);
            next.delete(hubId);
            return next;
          });
        }
      }
      if (convs.status === "fulfilled") setConversations(convs.value);
      if (cmds.status === "fulfilled") setSlashCommands(cmds.value);
      if (voiceRoster.status === "fulfilled") voice.setVoicePartByChannel(voiceRoster.value);
      // The hub is the source of truth for DM blocks; without this seed the
      // list silently reset to empty on every reload.
      if (dmBlocks.status === "fulfilled" && dmBlocks.value) setBlockedUsers(new Set(dmBlocks.value));
      const hubId = getActiveHubId();
      if (hubId) {
        getUnreadCounts().then((counts) => seedUnreadFromServer(hubId, counts)).catch(() => {});
      }
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
      // Show the onboarding survey if this hub has an active one we haven't
      // handled this session.
      // GET /survey/current only returns a survey when one is enabled (no
      // `enabled` field on the public shape), so its presence is the signal.
      getCurrentSurvey().then((s) => {
        if (s && s.questions.length > 0 && !surveyDismissedRef.current.has(s.id)) {
          setSurveyToShow(s);
        }
      }).catch(() => {});
    } finally {
      loadingHub.current = false;
    }
  }

  // Lobby -> member transition in place (lobby-bot-survey.md Feature 1):
  // /lobby/submit-pow already flipped the session's scope server-side on the
  // same token, so there's no re-auth here — just open the WS the hub had
  // been rejecting, drop the lobby screen, and pull the now-unlocked hub
  // data.
  async function handleLobbyPromoted(hubId: string) {
    setLobbyHubs((prev) => {
      if (!prev.has(hubId)) return prev;
      const next = new Set(prev);
      next.delete(hubId);
      return next;
    });
    connectHubWebSocket(hubId, stableHandlersRef.current);
    if (hubId === activeHubIdRef.current) {
      await loadHubData();
      publishDhKey().catch(() => {});
    }
    const hubName = hubsRef.current.find((h) => h.hub_id === hubId)?.hub_name ?? t("app.the_hub");
    showHubError(t("lobby.welcome", { hub: hubName }));
  }

  // === Hub management ===
  // handleSwitchHub/handleRemoveHub/handleHubReorder now live in
  // useHubLifecycle; applyDeepLinkTarget stays here since it also drives
  // handleSelectChannel/setPendingScrollMessageId (from useChannelMessages).

  // Applies a parsed channel/message permalink target once its hub is the
  // active one: selects the channel and, for a message target, queues the
  // scroll-to-message once that channel's history has loaded.
  async function applyDeepLinkTarget(hubId: string, target: NonNullable<HubInputResult["target"]>) {
    if (getActiveHubId() !== hubId) {
      await handleSwitchHub(hubId);
    }
    let list = channelsRef.current;
    try {
      list = await hubFetch("/channels").then((r) => r.json() as Promise<Channel[]>);
    } catch { /* fall back to whatever is already loaded */ }
    const ch = list.find((c) => c.id === target.channelId);
    if (!ch) {
      showHubError(t("hub.permalink.channel_not_found"));
      return;
    }
    await handleSelectChannel(ch);
    if (target.kind === "message") setPendingScrollMessageId(target.messageId);
  }

  const {
    hubUrl, setHubUrl,
    inviteCode, setInviteCode,
    hubPreview, setHubPreview,
    addingHub,
    addHubError, setAddHubError,
    fingerprintMatch, setFingerprintMatch,
    showAddHub, setShowAddHub,
    handleHubUrlInput,
    handlePreviewHub,
    handleAddHub,
    handleAddHubWithPasskey,
  } = useAddHubFlow({
    publicKey, stableHandlers, hubsRef, setHubs, setActiveHubIdState, loadHubData,
    applyDeepLinkTarget, t,
  });

  // An invite link is `https://hub.example/join/<code>`, and the hub serves
  // this client there. Pick the code out of our own address and open the
  // add-hub flow prefilled, so clicking the link a friend sent lands on the
  // hub preview instead of an empty app. Deliberately not an automatic join:
  // a link should not silently change someone's hub list.
  //
  // Runs once the identity exists — a first-time visitor has onboarding to do
  // first, and the code is held until then. The path is cleared only when the
  // invite is actually applied, so reloading mid-onboarding still honours the
  // link rather than losing it.
  const pathInviteRef = useRef<string | null>(null);
  const pathInviteHandledRef = useRef(false);
  if (pathInviteRef.current === null) {
    pathInviteRef.current = inviteCodeFromPath(window.location.pathname) ?? "";
  }

  // `?hub=&code=` — a hub build sending someone here to join it with their
  // real identity (USER_CLIENT_URL). Only ever a hub URL and an invite code:
  // both are public, both are visible in the address bar, and the add-hub
  // modal below is where the user confirms. A seed never arrives this way.
  const handoffRef = useRef<{ hub: string; code: string } | null | undefined>(undefined);
  if (handoffRef.current === undefined) {
    const params = new URLSearchParams(window.location.search);
    const hub = params.get("hub")?.trim() ?? "";
    handoffRef.current = hub ? { hub, code: params.get("code")?.trim() ?? "" } : null;
  }
  useEffect(() => {
    const code = pathInviteRef.current;
    const handoff = handoffRef.current;
    if ((!code && !handoff) || pathInviteHandledRef.current || !publicKey) return;
    if (!MULTI_HUB) {
      // Hub build: no add-hub modal to open, and which path is right depends
      // on whether we already have a session here — so wait for the restore
      // to answer rather than racing it.
      if (!hubsRestored) return;
      // A `?hub=` handoff is meaningless here — the hub build sends those, it
      // cannot receive one, because it has no second hub to add.
      if (!code) return;
      pathInviteHandledRef.current = true;
      window.history.replaceState({}, "", "/");
      if (getActiveHubId()) {
        // Already a member: re-authenticating is the registration path and
        // would not apply the invite's role grant. This route is the one
        // that does.
        void redeemInvite(code)
          .then(() => loadHubData())
          .catch((e: unknown) => showHubError(e instanceof Error ? e.message : String(e)));
      } else {
        // No session: the welcome screen joins the hub serving this page, and
        // parseHubInput lifts the code out of whatever URL it is handed — so
        // handing it the invite link is the whole flow.
        setHomeHubUrl(`${window.location.origin}/join/${code}`);
      }
      return;
    }
    pathInviteHandledRef.current = true;
    window.history.replaceState({}, "", "/");
    // Both sources end up as an invite URL because parseHubInput already
    // knows how to take a code out of one — one shape to handle, not two.
    const target = handoff
      ? handoffTargetUrl(handoff.hub, handoff.code)
      : `${window.location.origin}/join/${code}`;
    handleHubUrlInput(target);
    setShowAddHub(true);
  }, [publicKey, hubsRestored]);

  async function handleSaveFirstRunName(typed: string) {
    const name = typed.trim();
    if (!name) { setShowDisplayNamePrompt(false); return; }
    try {
      await hubFetch("/me", { method: "PATCH", body: JSON.stringify({ display_name: name }) });
      setMeInfo((prev) => prev ? { ...prev, display_name: name } : prev);
    } catch { /* non-critical, ignore */ }
    setShowDisplayNamePrompt(false);
  }

  // === Channel / messages ===
  // handleSelectChannel/handleSelectAllianceChannel/handleSendAllianceMessage
  // and the composer/edit/reaction handlers below now live in
  // useChannelMessages.

  // Expands whatever ancestor categories are collapsed so a breadcrumb
  // category crumb (nested-channels-ux.md §1.4) becomes visible, then
  // scrolls the sidebar to it.
  function handleBreadcrumbCategoryClick(categoryId: string) {
    const hubId = activeHubId;
    if (!hubId) return;
    const ancestorsAbove = channelPath(channels, categoryId).slice(0, -1);
    if (ancestorsAbove.length > 0) {
      setCollapsedCategories((prev) => {
        const m = { ...(prev[hubId] ?? {}) };
        let changed = false;
        for (const anc of ancestorsAbove) {
          if (m[anc.id]) { delete m[anc.id]; changed = true; }
        }
        return changed ? { ...prev, [hubId]: m } : prev;
      });
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById(`sidebar-node-${categoryId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
  }

  async function handleChannelDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    const forbidden = descendantIds(channelTree, activeId);
    if (forbidden.has(overId)) return;

    const allFlat = flattenTree(channelTree);
    const activeFlat = allFlat.find((n) => n.node.id === activeId);
    const overFlat = allFlat.find((n) => n.node.id === overId);
    if (!activeFlat || !overFlat) return;

    // Edge-zone rule (nested-channels-ux drag&drop fix): dropping on the
    // top/bottom edge of a category reorders as a sibling instead of always
    // nesting — otherwise root-level items could never be reordered around
    // a category.
    const intent = over.rect
      ? computeDragIntent(active.rect.current.translated, over.rect, overFlat.node.is_category)
      : "before";
    const willNest = intent === "nest";

    if (maxChannelDepth > 0) {
      const maxCodeDepth = maxChannelDepth - 1;
      const parentForDepth = willNest ? overFlat.node.id : overFlat.parentId;
      const newDepth = parentForDepth !== null
        ? computeDepth(channels, parentForDepth) + 1
        : 0;
      if (newDepth > maxCodeDepth) return;
      if (activeFlat.node.is_category && newDepth >= maxCodeDepth) return;
    }

    const newParentId = willNest ? overFlat.node.id : overFlat.parentId;
    const parentChanged = newParentId !== activeFlat.node.parent_id;

    const channelsWithNewParent = parentChanged
      ? channels.map((c) => (c.id === activeId ? { ...c, parent_id: newParentId } : c))
      : channels;

    const sorted = [...channelsWithNewParent].sort((a, b) => a.display_order - b.display_order);
    const oldIndex = sorted.findIndex((c) => c.id === activeId);
    const newIndex = sorted.findIndex((c) => c.id === overId);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(sorted, oldIndex, newIndex);
    setChannels(reordered.map((c, i) => ({ ...c, display_order: i })));

    try {
      const { moveChannel, reorderChannels } = await import("./platform/commands/hubAdmin");
      if (parentChanged) {
        await moveChannel(activeId, newParentId);
      }
      await reorderChannels(reordered.map((c) => c.id));
    } catch { /* optimistic — ignore network errors */ }
  }

  // Mover's side: right-click "Move to channel…" (events.md §7.1) and the
  // event staging panel (§7.5, eventId set) both funnel through here.
  function handleMoveMember(targetPubkey: string, targetChannelId: string, eventId?: string) {
    const ws = activeSession().ws;
    if (!ws) { showHubError("Not connected"); return; }
    ws.sendVoiceMove(targetPubkey, targetChannelId, eventId);
  }

  const isAdmin = useMemo(
    () => meInfo?.roles?.some((r) => r.permissions?.includes("admin")) ?? false,
    [meInfo],
  );

  // First-run hub setup wizard (decisions.md 2026-07-25): shown once per hub
  // when an admin lands on an empty channel list. "Done" covers both
  // "picked a template" and "started blank" — never re-nag either way.
  const { showHubSetupWizard, setShowHubSetupWizard, closeHubSetupWizard } = useHubSetupWizardGate({
    storageGet: () => getScoped("wavvon.hubSetupWizardDone"),
    storageSet: (raw) => { try { setScoped("wavvon.hubSetupWizardDone", raw); } catch { /* storage unavailable */ } },
    activeHubId,
    isAdmin,
    channelCount: channels.length,
  });

  const channelCrud = useChannelCrud({
    setChannels, selectedChannel, setSelectedChannel, showHubError, handleSelectChannel,
    activeHubId, closeHubSetupWizard,
  });
  const {
    createChannelCtx, setCreateChannelCtx,
    createChannelLoading,
    createChannelError, setCreateChannelError,
    channelSettingsCtx, setChannelSettingsCtx,
    channelSettingsSaving,
    channelSettingsDeleting,
    channelSettingsError, setChannelSettingsError,
    editDescChannel, setEditDescChannel,
    editDescValue, setEditDescValue,
    renameRoomCtx, setRenameRoomCtx,
    renameRoomName, setRenameRoomName,
    renameRoomSaving,
    renameRoomError, setRenameRoomError,
    handleCreateChannel,
    createChannelForWizard,
    handleSaveChannelSettings,
    handleDeleteChannel,
    handleSaveDescription,
    handleRenameRoom,
    handleHubSetupWizardComplete,
  } = channelCrud;

  const canManageRoles = useMemo(
    () => meInfo?.roles?.some((r) => r.permissions?.includes("admin") || r.permissions?.includes("manage_roles")) ?? false,
    [meInfo],
  );

  // Gates the voice roster's "Move to channel…" entry (events.md §7.1). The
  // hub re-checks channel-scoped against the destination on every voice_move —
  // this is UX-only, same posture as the other client-side permission gates here.
  const canMoveMembers = useMemo(
    () => meInfo?.roles?.some((r) => r.permissions?.includes("admin") || r.permissions?.includes("move_members")) ?? false,
    [meInfo],
  );

  const voiceMoveChannelOptions = useMemo(
    () => moveChannelOptions(channels).filter((c) => c.id !== voiceMoveUx.voiceMoveMenu?.currentChannelId),
    [channels, voiceMoveUx.voiceMoveMenu],
  );

  // Same permission the invite endpoints require (routes/invites.rs) — gates
  // the "Invite people" entry for non-admin members too.
  const canCreateInvites = useMemo(
    () => isAdmin || (meInfo?.roles?.some((r) => r.permissions?.includes("manage_channels")) ?? false),
    [isAdmin, meInfo],
  );

  // Same permission the poll-create endpoint requires (SEND_MESSAGES) —
  // gates the "Create poll" context-menu entry the same way the composer's
  // own "+" attach menu is implicitly gated (anyone who can post here).
  const canSendMessages = useMemo(
    () => meInfo?.roles?.some((r) => r.permissions?.includes("admin") || r.permissions?.includes("send_messages")) ?? false,
    [meInfo],
  );

  const canUseSoundboard = useMemo(() => {
    if (voice.myVoicePerms && voice.myVoicePerms.channel_id === voice.voiceChannelId) {
      return voice.myVoicePerms.is_admin || voice.myVoicePerms.permissions.includes("use_soundboard");
    }
    return meInfo?.roles?.some((r) => r.permissions?.includes("admin") || r.permissions?.includes("use_soundboard")) ?? false;
  }, [voice.myVoicePerms, voice.voiceChannelId, meInfo]);

  const canManageSoundboard = useMemo(
    () => meInfo?.roles?.some((r) => r.permissions?.includes("admin") || r.permissions?.includes("manage_soundboard")) ?? false,
    [meInfo],
  );

  const myRoles = useMemo(() => meInfo?.roles ?? [], [meInfo]);

  // Highest priority among the viewer's own roles — the hub only lets you
  // assign/remove roles strictly below your own priority.
  const myMaxPriority = useMemo(
    () => myRoles.reduce((m, r) => Math.max(m, r.priority), 0),
    [myRoles],
  );

  const userContextMenuActions: UserContextMenuActions = {
    listRoles,
    listUserRoles,
    assignRole: assignRoleToUser,
    removeRole: removeRoleFromUser,
    muteUser: (pubkey) => hubFetch("/moderation/mutes", { method: "POST", body: JSON.stringify({ target_public_key: pubkey }) }).then(() => {}),
    kickUser: (pubkey) => hubFetch("/moderation/kick", { method: "POST", body: JSON.stringify({ target_public_key: pubkey }) }).then(() => {}),
    banUser: (pubkey) => hubFetch("/moderation/bans", { method: "POST", body: JSON.stringify({ target_public_key: pubkey }) }).then(() => {}),
    dm: (user) => handleStartConversation(user.public_key),
    addFriend: (user) => {
      void sendFriendRequest(user.public_key)
        .then(() => showHubError(`Friend request sent to ${user.display_name ?? user.public_key.slice(0, 8)}`))
        .catch((e) => showHubError(`Failed to send friend request: ${e}`));
    },
    toggleBlock: toggleBlockUser,
    toggleIgnore: toggleIgnoreUser,
    fetchMemberHistory,
  };

  const knownDisplayNames = useMemo(
    () => new Set(users.map((u) => u.display_name).filter(Boolean) as string[]),
    [users],
  );

  const channelTree = useMemo<TreeNode[]>(
    () => buildChannelTree(channels),
    [channels],
  );

  useAppKeybinds({
    hubs, channels, selectedChannel, messageInputRef, unreadByChannel, activeHubIdRef,
    setActiveHubIdState, handleSelectChannel,
    showKeyboardShortcuts, setShowKeyboardShortcuts,
    showSettings, setShowSettings,
    showHubAdmin, setShowHubAdmin,
    showAddHub, setShowAddHub,
    showQuickInvite, setShowQuickInvite,
    showSearchBar, setShowSearchBar,
    searchOpen, setSearchOpen,
  });

  // === Render ===

  if (ready === "checking") {
    return <div style={{ padding: 32 }}>{t("app.loading")}</div>;
  }

  if (ready === "setup") {
    return <IdentitySetupScreen onComplete={handleIdentityComplete} />;
  }

  // With zero hubs joined, "channels" view has nothing to show — force the
  // rail into the DM/friends view so the shell chrome (footer identity,
  // friends button, +add-hub) stays meaningful instead of showing an empty
  // hub header.
  const hasNoHubs = hubs.length === 0;
  const sidebarView = hasNoHubs ? "dms" : view;

  return (
    <div className="main-layout">
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      >
        {assertiveAnnouncement}
      </div>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {voicePoliteAnnouncement}
      </div>
      <WhisperInbox
        entries={whisper.inboundWhisperLog.map((e) => ({
          ...e,
          name: users.find((u) => u.public_key === e.pubkey)?.display_name || e.pubkey.slice(0, 8),
        }))}
        onDismiss={whisper.dismissInbound}
        onClearAll={whisper.clearInbound}
      />

      {hubErrorToast && (
        <div
          style={{
            position: "fixed", top: 52, left: "50%", transform: "translateX(-50%)",
            background: "var(--surface)", border: "1px solid var(--danger, #e05252)",
            borderRadius: "var(--r-md)", padding: "8px 16px", zIndex: 9999,
            fontSize: "var(--text-sm)", color: "var(--danger, #e05252)",
          }}
        >
          {hubErrorToast}
        </div>
      )}

      {voiceMoveUx.voiceMoveToast && (
        <VoiceMoveToast
          channelName={voiceMoveUx.voiceMoveToast.channelName}
          canRejoin={voiceMoveUx.voiceMoveToast.sourceChannelId !== null}
          onRejoin={voiceMoveUx.handleRejoinPreviousVoiceChannel}
          onDismiss={voiceMoveUx.dismissVoiceMoveToast}
        />
      )}

      {voiceMoveUx.voiceMovePrompt && (
        <VoiceMovePromptModal
          channelName={voiceMoveUx.voiceMovePrompt.targetChannelName}
          onAccept={voiceMoveUx.handleAcceptVoiceMove}
          onDecline={voiceMoveUx.handleDeclineVoiceMove}
        />
      )}

      {voiceMoveUx.voiceMoveMenu && (
        <VoiceMoveMenu
          displayName={voiceMoveUx.voiceMoveMenu.displayName}
          position={voiceMoveUx.voiceMoveMenu.position}
          channels={voiceMoveChannelOptions}
          onMove={(channelId) => { handleMoveMember(voiceMoveUx.voiceMoveMenu!.pubkey, channelId); voiceMoveUx.setVoiceMoveMenu(null); }}
          onClose={() => voiceMoveUx.setVoiceMoveMenu(null)}
        />
      )}

      {sharing && (
        <ScreenShareSelfPreview
          stream={shareLocalStream}
          kbps={shareKbps}
          onStop={handleStopShare}
        />
      )}

      {showKeyboardShortcuts && (
        <KeyboardShortcuts onClose={() => setShowKeyboardShortcuts(false)} />
      )}

      {showDiscover && DISCOVERY_URL && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9000, background: "var(--bg, #1a1a2e)", overflow: "auto" }}>
          <DiscoverPage
            onClose={() => setShowDiscover(false)}
            onJoinHub={(hubUrl, inviteCode) => {
              setHubUrl(hubUrl);
              setInviteCode(inviteCode);
              setShowDiscover(false);
              setShowAddHub(true);
            }}
            fetchUrl={fetchWithTimeout}
            directoryUrl={DISCOVERY_URL}
          />
        </div>
      )}

      {showSearchBar && (
        <SearchBar
          onSearch={(q) => hubFetch(`/search?q=${encodeURIComponent(q)}`).then((r) => r.json())}
          onClose={() => setShowSearchBar(false)}
          onNavigate={(channelId, _messageId) => {
            const ch = channels.find((c) => c.id === channelId);
            if (ch) void handleSelectChannel(ch);
            setShowSearchBar(false);
          }}
        />
      )}

      {showFriends && (
        <FriendsModal
          actions={{ listFriends, listPendingFriendRequests, sendFriendRequest, acceptFriendRequest, removeFriend }}
          onClose={() => setShowFriends(false)}
          onToast={(msg) => showHubError(msg)}
        />
      )}

      {showHubStreams && (
        <HubStreamsPanel
          streams={hubStreams}
          subscribedIds={subscribedStreamIds.current}
          currentChannelId={selectedChannel?.id ?? null}
          channels={channels}
          nameFor={(pk) => users.find((u) => u.public_key === pk)?.display_name || pk.slice(0, 8)}
          onWatch={handleWatchStream}
          onStopWatch={handleStopWatchStream}
          onClose={() => setShowHubStreams(false)}
        />
      )}

      {surveyToShow && (
        <SurveyModal
          survey={surveyToShow}
          onDone={() => { surveyDismissedRef.current.add(surveyToShow.id); setSurveyToShow(null); }}
          onSkip={() => { surveyDismissedRef.current.add(surveyToShow.id); setSurveyToShow(null); }}
        />
      )}

      <SettingsPageContainer
        settingsProfile={settingsProfile}
        notifyPrefs={notifyPrefs}
        hubs={hubs}
        publicKey={publicKey}
        blockedUsers={blockedUsers}
        ignoredUsers={ignoredUsers}
        knownNames={pubkeyToName}
        inVoice={voice.voiceChannelId !== null}
        onHubProfileSaved={handleHubProfileSaved}
        onUnblock={toggleBlockUser}
        onUnignore={toggleIgnoreUser}
      />

      {userContextMenu && (
        <UserContextMenu
          user={userContextMenu.user}
          publicKey={publicKey}
          isAdmin={isAdmin}
          canManageRoles={canManageRoles}
          myMaxPriority={myMaxPriority}
          blockedUsers={blockedUsers}
          ignoredUsers={ignoredUsers}
          position={userContextMenu.position}
          actions={userContextMenuActions}
          onClose={() => setUserContextMenu(null)}
          onToast={(msg) => showHubError(msg)}
          onRolesChanged={() => {
            fetchAllUsers().then(setUsers).catch(() => {});
          }}
        />
      )}

      {voice.voiceChannelId && (video.videoEnabled || video.remoteVideoStreams.size > 0) && (
        <VideoPipWindow
          title={`#${channels.find((c) => c.id === voice.voiceChannelId)?.name ?? "voice"}`}
          localStream={video.localVideoStream}
          remoteStreams={video.remoteVideoStreams}
          nameFor={(pk) => users.find((u) => u.public_key === pk)?.display_name || pk.slice(0, 8)}
        />
      )}

      <MobileShell
        showHubSidebar
        showChannelSidebar
        showContent
        onBack={() => {}}
      >
      <HubSidebar
        hubs={hubs}
        activeHubId={activeHubId}
        view={sidebarView as "channels" | "dms"}
        showDiscover={true}
        unreadDms={unreadDms}
        unreadByHub={unreadByHub}
        pingByHub={pingByHub}
        hubNotifyMode={hubNotifyMode}
        lobbyHubIds={lobbyHubs}
        hasActiveHub={!!activeHubId}
        onSwitchToDms={() => setView("dms")}
        onSwitchHub={handleSwitchHub}
        onRemoveHub={(hubId: string) => removeHubConfirm.requestRemoveHub(hubId, hubs)}
        onSetHubNotifyMode={(hubId, mode) =>
          setHubNotifyMode((prev) => { const n = { ...prev }; if (mode === "all") delete n[hubId]; else n[hubId] = mode; return n; })
        }
        onHubReorder={handleHubReorder}
        onAddHub={MULTI_HUB ? () => setShowAddHub(true) : undefined}
        onDiscover={DISCOVERY_URL ? () => setShowDiscover(true) : undefined}
      />

      <ChannelSidebarContainer
        voice={voice}
        video={video}
        whisper={whisper}
        voiceMoveUx={voiceMoveUx}
        notifyPrefs={notifyPrefs}
        hubLifecycle={hubLifecycle}
        onRequestRemoveHub={(hubId: string) => removeHubConfirm.requestRemoveHub(hubId, hubs)}
        unreadCounts={unreadCounts}
        dms={dms}
        alliances={alliances}
        presence={presence}
        screenShare={screenShare}
        channelCrud={channelCrud}
        channelMessages={channelMessages}
        hubAdmin={hubAdminState}
        view={sidebarView as "channels" | "dms"}
        channels={channels}
        channelTree={channelTree}
        users={users}
        publicKey={publicKey}
        isAdmin={isAdmin}
        canCreateInvites={canCreateInvites}
        canManageRoles={canManageRoles}
        canMoveMembers={canMoveMembers}
        canUseSoundboard={canUseSoundboard}
        silencedChannelIds={silencedChannelIds}
        soundboardChipsByChannel={soundboardChipsByChannel}
        whisperReplyBind={whisperReplyBind}
        onSetWhisperReplyBind={setWhisperReplyBind}
        onOpenQuickInvite={() => setShowQuickInvite(true)}
        onChannelContextMenu={(e, channel) => { e.preventDefault(); setChannelCtxMenu({ channel, x: e.clientX, y: e.clientY }); }}
        onOpenFriends={() => setShowFriends(true)}
        onOpenSettings={() => setShowSettings(true)}
        settingsNeedsAttention={identityNeedsBackup}
        onOpenSearch={() => setShowSearchBar(true)}
        onDragEnd={handleChannelDragEnd}
      />

      {activeOpenApp && (
        <GameModal
          miniAppUrl={activeOpenApp.event.mini_app_url}
          sessionToken={activeOpenApp.event.session_token}
          channelId={activeOpenApp.event.channel_id}
          botId={activeOpenApp.event.bot_id}
          hubUrl={activeOpenApp.hubUrl}
          title={activeBotApps.get(activeOpenApp.event.bot_id)?.title ?? t("bot.app.default_title")}
          requiresCamera={activeOpenApp.event.requires_camera}
          onClose={() => setActiveOpenApp(null)}
        />
      )}

      {hasNoHubs ? (
        <main className="content" style={{ overflow: "auto" }}>
          <WelcomeScreenContainer
            wsHandlers={stableHandlers}
            onHubAdded={(hub, target) => {
              setHubs(listHubs());
              setActiveHubIdState(hub.hub_id);
              // Same post-join publish as the Add-hub modal paths — without
              // it a first-run user has no DH key on their first hub until
              // the next reload, so DMs to them fall back to plaintext and
              // their encrypted sends can't be decrypted by the peer.
              publishDhKey().catch(() => {});
              void loadHubData().then(() => {
                if (target) return applyDeepLinkTarget(hub.hub_id, target);
              });
            }}
            initialHubUrl={homeHubUrl}
            onBrowse={DISCOVERY_URL ? () => setShowDiscover(true) : undefined}
          />
        </main>
      ) : activeHubId && lobbyHubs.has(activeHubId) && publicKey ? (
        <main className="content" style={{ overflow: "auto" }}>
          <Lobby
            key={activeHubId}
            hubId={activeHubId}
            hubName={hubs.find((h) => h.hub_id === activeHubId)?.hub_name ?? ""}
            pubkeyHex={publicKey}
            actions={{
              getStatus: getLobbyStatus,
              getWelcome: getLobbyWelcome,
              submitProof: submitLobbyPow,
            }}
            onPromoted={() => void handleLobbyPromoted(activeHubId)}
          />
        </main>
      ) : activeHubId && pendingApprovalHubs.has(activeHubId) ? (
        <main className="content" style={{ display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 40 }}>⏳</div>
          <h2 style={{ margin: 0 }}>{t("app.approval.title")}</h2>
          <p className="muted" style={{ margin: 0, textAlign: "center", maxWidth: 320 }}>
            {t("app.approval.body")}
          </p>
          <button className="btn-secondary" onClick={() => loadHubData()}>{t("app.approval.check_again")}</button>
        </main>
      ) : <>
        {(() => {
          if (!selectedChannel) return null;
          const cards = Array.from(activeBotApps.values()).filter(
            (ev) => ev.channel_id === selectedChannel.id,
          );
          if (cards.length === 0) return null;
          return (
            <div className="bot-app-launch-cards">
              {cards.map((ev) => (
                <BotAppLaunchCard
                  key={ev.bot_id}
                  event={ev}
                  onJoin={sendBotAppJoin}
                />
              ))}
            </div>
          );
        })()}
        <ContentArea
          channelMessages={channelMessages}
          dms={dms}
          alliances={alliances}
          hubLifecycle={hubLifecycle}
          hubConnection={hubConnection}
          voice={voice}
          screenShare={screenShare}
          notifyPrefs={notifyPrefs}
          channelCrud={channelCrud}
          typing={typingIndicators}
          view={view as "channels" | "dms"}
          channels={channels}
          onBreadcrumbCategoryClick={handleBreadcrumbCategoryClick}
          users={users}
          publicKey={publicKey}
          blockedUsers={blockedUsers}
          ignoredUsers={ignoredUsers}
          knownDisplayNames={knownDisplayNames}
          myDisplayName={meInfo?.display_name ?? null}
          isAdmin={isAdmin}
          myRoles={myRoles}
          memberSidebarHidden={memberSidebarHidden}
          onSetMemberSidebarHidden={setMemberSidebarHidden}
          selfInvisible={myPresence.status === "invisible"}
          onSetUserContextMenu={(menu) => {
            if (!menu) { setUserContextMenu(null); return; }
            setUserContextMenu({ user: menu.user, position: { x: menu.x, y: menu.y } });
          }}
          onToast={showHubError}
          slashCommands={slashCommands}
          canMoveMembers={canMoveMembers}
          onMoveMember={handleMoveMember}
        /></>}
      </MobileShell>

      <AppModals
        removeHub={removeHubConfirm}
        encryptionWarning={dms.encryptionWarning}
        onOpenHomeHubSettings={() => {
          removeHubConfirm.cancel();
          settingsProfile.setSettingsTab("accounts");
          setShowSettings(true);
        }}
        showBackupPrompt={showBackupPrompt}
        onBackupPromptShowPhrase={() => {
          setShowBackupPrompt(false);
          settingsProfile.setSettingsTab("accounts");
          setShowSettings(true);
        }}
        onBackupPromptLater={() => setShowBackupPrompt(false)}
        activeHubId={activeHubId}
        addHubError={addHubError}
        addingHub={addingHub}
        canManageRoles={canManageRoles}
        canManageSoundboard={canManageSoundboard}
        canSendMessages={canSendMessages}
        channelBansTabActions={channelBansTabActions}
        channelCtxMenu={channelCtxMenu}
        channelPermissionsTabActions={channelPermissionsTabActions}
        channelSettingsCtx={channelSettingsCtx}
        channelSettingsDeleting={channelSettingsDeleting}
        channelSettingsError={channelSettingsError}
        channelSettingsSaving={channelSettingsSaving}
        channelTalkPowerTabActions={channelTalkPowerTabActions}
        channels={channels}
        closeHubSetupWizard={closeHubSetupWizard}
        createChannelCtx={createChannelCtx}
        createChannelError={createChannelError}
        createChannelForWizard={createChannelForWizard}
        createChannelLoading={createChannelLoading}
        editDescChannel={editDescChannel}
        editDescValue={editDescValue}
        effectiveNotifyMode={effectiveNotifyMode}
        eventComposerChannelId={eventComposerChannelId}
        fingerprintMatch={fingerprintMatch}
        handleAddHub={handleAddHub}
        handleAddHubWithPasskey={handleAddHubWithPasskey}
        handleCreateChannel={handleCreateChannel}
        handleDeleteChannel={handleDeleteChannel}
        handleHubSetupWizardComplete={handleHubSetupWizardComplete}
        handleHubUrlInput={handleHubUrlInput}
        handleRenameRoom={handleRenameRoom}
        handleSaveChannelSettings={handleSaveChannelSettings}
        handleSaveDescription={handleSaveDescription}
        handleSaveFirstRunName={handleSaveFirstRunName}
        hubAdminState={hubAdminState}
        hubPreview={hubPreview}
        hubUrl={hubUrl}
        hubs={hubs}
        inviteCode={inviteCode}
        isAdmin={isAdmin}
        myMaxPriority={myMaxPriority}
        pollComposerChannelId={pollComposerChannelId}
        publicKey={publicKey}
        renameRoomCtx={renameRoomCtx}
        renameRoomError={renameRoomError}
        renameRoomName={renameRoomName}
        renameRoomSaving={renameRoomSaving}
        setAddHubError={setAddHubError}
        setChannelCtxMenu={setChannelCtxMenu}
        setChannelNotifyMode={setChannelNotifyMode}
        setChannelSettingsCtx={setChannelSettingsCtx}
        setChannelSettingsError={setChannelSettingsError}
        setCreateChannelCtx={setCreateChannelCtx}
        setCreateChannelError={setCreateChannelError}
        setEditDescChannel={setEditDescChannel}
        setEditDescValue={setEditDescValue}
        setEventComposerChannelId={setEventComposerChannelId}
        setFingerprintMatch={setFingerprintMatch}
        setHubPreview={setHubPreview}
        setInviteCode={setInviteCode}
        setPollComposerChannelId={setPollComposerChannelId}
        setRenameRoomCtx={setRenameRoomCtx}
        setRenameRoomError={setRenameRoomError}
        setRenameRoomName={setRenameRoomName}
        setShowAddHub={setShowAddHub}
        setShowDiscover={setShowDiscover}
        setShowDisplayNamePrompt={setShowDisplayNamePrompt}
        setShowHubAdmin={setShowHubAdmin}
        setShowQuickInvite={setShowQuickInvite}
        showAddHub={showAddHub}
        showDisplayNamePrompt={showDisplayNamePrompt}
        showHubAdmin={showHubAdmin}
        showHubError={showHubError}
        showHubSetupWizard={showHubSetupWizard}
        showQuickInvite={showQuickInvite}
        users={users}
      />
    </div>
  );
}
