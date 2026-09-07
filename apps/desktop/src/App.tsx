// App.tsx — Root component
//
// React concepts for Blazor devs:
// - useState(initial) returns [value, setter] — private field + setter
// - useEffect(fn, [deps]) runs fn when deps change — like OnParametersSet
// - useRef(initial) persists a value across renders — like a field that doesn't trigger re-render
// - Event handlers use camelCase: onClick, onChange, onSubmit

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DISCOVERY_URL } from "./constants";
import { invoke } from "@tauri-apps/api/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import type {
  Channel,
  Attachment,
  ReplyContext,
  Message,
  NotifyMode,
  User,
  VoiceParticipant,
  Hub,
  MeInfo,
  BanInfo,
  Conversation,
  DmMessage,
  AllianceInfo,
  AllianceSharedChannel,
  ActiveStream,
  LobbyStatus,
  BotAppLaunchEvent,
  BotAppOpenEvent,
  BotAppCloseEvent,
} from "./types";
import { BotAppLaunchCard, DiscoverPage, Lobby, type CreateEventPayload, type HubEvent, type Poll } from "@wavvon/ui";
import { VoiceMoveMenu, VoiceMoveToast, VoiceMovePromptModal, SearchBar, moveChannelOptions, computeDragIntent } from "@wavvon/ui";
import { useVoiceMoveUx, usePresenceStatus, useHubSetupWizardGate, useSoundboardChips } from "@wavvon/ui";
import { useWhisperKeybinds, pickReplyPubkey, WhisperInbox } from "@wavvon/ui";
import type { WhisperReplyBind, WhisperTarget } from "@wavvon/ui";
import { loadWhisperReplyBind, saveWhisperReplyBind } from "./utils/whisperReply";
import type { GlobalSearchResult } from "@wavvon/ui";
import { useVoice } from "./hooks/useVoice";
import { useSoundboard } from "./hooks/useSoundboard";
import { useVideo } from "./hooks/useVideo";
import { useWhisper } from "./hooks/useWhisper";
import { useAddHubFlow } from "./hooks/useAddHubFlow";
import { useChannelCrud } from "./hooks/useChannelCrud";
import { VideoGrid } from "./components/VideoGrid";
import { type ThemeId, type WavvonSkin, applySkinTokens, clearSkinTokens } from "@wavvon/ui";
import {
  formatPubkey,
  buildChannelTree,
  flattenTree,
  descendantIds,
  computeDepth,
} from "@wavvon/core";
import { parseHubInput } from "@wavvon/core";
import { useNotificationPrefs } from "./hooks/useNotificationPrefs";
import { useUnreadCounts } from "@wavvon/ui";
import { unreadPersistence } from "./unreadPersistence";
import { useTypingIndicators } from "./hooks/useTypingIndicators";
import { useHubConnections } from "./hooks/useHubConnections";
import { useHubLifecycle } from "./hooks/useHubLifecycle";
import { useHubAdmin } from "./hooks/useHubAdmin";
import { useFriends } from "./hooks/useFriends";
import { useSettingsProfile } from "./hooks/useSettingsProfile";
import { useDms } from "./hooks/useDms";
import { useChannelMessages } from "./hooks/useChannelMessages";
import { useAlliances } from "./hooks/useAlliances";
import { useWsHandlers } from "./hooks/useWsHandlers";
import { useUpdateBanner } from "./hooks/useUpdateBanner";
import { useFirstNotify } from "./hooks/useFirstNotify";
import { buildVideoTiles } from "./utils/buildVideoTiles";
import { useSlashCommands } from "./hooks/useSlashCommands";
import { SettingsPageContainer } from "./components/SettingsPageContainer";
import { HubAdminContainer } from "./components/HubAdminContainer";
import { AppModals } from "./components/AppModals";
import { HubSidebar } from "@wavvon/ui";
import { ChannelSidebarContainer } from "./components/ChannelSidebarContainer";
import { ContentAreaContainer } from "./components/ContentAreaContainer";
import { fetchWithTimeout } from "./utils/fetchWithTimeout";
import { HubBrowser } from "./components/HubBrowser";
import { WelcomeScreen } from "@wavvon/ui";
import { UpdateBanner } from "./components/UpdateBanner";
import { setSwitchGuard } from "./accounts/store";
import { loadDefaultProfileAsync } from "./utils/profileEditorActions";
import { DisplayNamePrompt } from "@wavvon/ui";

function App() {
  const { t } = useTranslation();
  const [showQuickInvite, setShowQuickInvite] = useState(false);
  const [pendingSurveyHubId, setPendingSurveyHubId] = useState<string | null>(null);
  const unreadCounts = useUnreadCounts(unreadPersistence);
  const {
    unreadByChannel,
    unreadByHub,
    unreadDms,
    setUnreadDms,
    bumpUnread,
    clearUnread,
    clearHubUnread,
  } = unreadCounts;

  const notifyPrefs = useNotificationPrefs();
  const {
    hubNotifyMode,
    channelNotifyMode,
    setHubMode,
    setChannelMode,
  } = notifyPrefs;

  // Blocked users: pubkey set. Persisted to ~/.wavvon/blocked_users.json so
  // the choice carries across sessions. Used to filter out their messages
  // from channel + DM views without involving any hub state.
  const [blockedUsers, setBlockedUsers] = useState<Set<string>>(new Set());

  function toggleBlockUser(pubkey: string) {
    setBlockedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(pubkey)) next.delete(pubkey);
      else next.add(pubkey);
      const list = Array.from(next);
      invoke("save_blocked_users", { blocked: list }).catch(() => {});
      invoke("update_dm_blocks", { blocked: list }).catch(() => {});
      return next;
    });
  }

  const [ignoredUsers, setIgnoredUsers] = useState<Set<string>>(new Set());

  function toggleIgnoreUser(pubkey: string) {
    setIgnoredUsers((prev) => {
      const next = new Set(prev);
      if (next.has(pubkey)) next.delete(pubkey);
      else next.add(pubkey);
      invoke("save_ignored_users", { ignored: Array.from(next) }).catch(() => {});
      return next;
    });
  }

  // Own presence — global across hubs, not per-hub. The device is the
  // source of truth: the picker broadcasts to every session and each hub
  // gets it re-applied on (re)connect. Distinct from hub mute (notify modes).
  // Four states + "clear after" TTL (decisions.md 2026-07-12) — free-text
  // custom status was removed; the hub column stays dormant.
  const { myPresence, myPresenceRef, handleSetStatus } = usePresenceStatus({
    loadRaw: () => localStorage.getItem("wavvon.presence"),
    persist: (p) => { localStorage.setItem("wavvon.presence", JSON.stringify(p)); },
    broadcast: (s) => {
      invoke("send_all_hubs_ws_raw", {
        payload: JSON.stringify({ type: "set_status", status: s, custom: null }),
      }).catch(() => { /* no hub connected */ });
    },
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

  // Collapsed categories: hub_id -> { category_id: true }. Persisted so a
  // folded category stays folded across restarts. Categories not in the
  // map render expanded by default.
  const [collapsedCategories, setCollapsedCategories] = useState<
    Record<string, Record<string, boolean>>
  >({});

  function toggleCategoryCollapsed(hubId: string, categoryId: string) {
    setCollapsedCategories((prev) => {
      const hubMap = { ...(prev[hubId] ?? {}) };
      if (hubMap[categoryId]) delete hubMap[categoryId];
      else hubMap[categoryId] = true;
      const next = { ...prev, [hubId]: hubMap };
      invoke("save_collapsed_categories", { state: next }).catch(() => {});
      return next;
    });
  }

  const hubConnections = useHubConnections();
  const {
    setHubConnected,
    scheduleReconnect,
    clearReconnectTimer,
    setReconnecting,
    resetAttempts,
    onHubReconnected,
    onHubRemoved: onHubRemovedReconnect,
    cancelAllReconnectTimers,
  } = hubConnections;

  function effectiveNotifyMode(hubId: string, channelId: string): NotifyMode {
    let id: string | null = channelId;
    while (id !== null) {
      const mode = channelNotifyMode[hubId]?.[id];
      if (mode !== undefined) return mode;
      const ch = channels.find((c) => c.id === id);
      id = ch?.parent_id ?? null;
    }
    return hubNotifyMode[hubId] ?? "all";
  }

  // Hydrate collapsed-category state on launch.
  useEffect(() => {
    invoke<Record<string, Record<string, boolean>>>("load_collapsed_categories")
      .then((s) => setCollapsedCategories(s ?? {}))
      .catch(console.error);
  }, []);

  // Hydrate blocked-users list on launch.
  useEffect(() => {
    invoke<string[]>("load_blocked_users")
      .then((s) => setBlockedUsers(new Set(s ?? [])))
      .catch(console.error);

    invoke<string[]>("load_ignored_users")
      .then((s) => setIgnoredUsers(new Set(s ?? [])))
      .catch(() => {});
  }, []);

  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const hubLifecycle = useHubLifecycle({
    setError,
    clearReconnectTimer,
    resetAttempts,
    setReconnecting,
    scheduleReconnect,
    clearHubUnread,
    onHubRemovedReconnect,
  });
  const {
    hubs, setHubs, hubsRef,
    activeHubId, setActiveHubId, activeHubIdRef,
    setActiveHubTimezone,
    hubScope, setHubScope, lobbyHubIds,
    pingByHub,
    handleHubReorder,
    handleSwitchHub,
    handleRemoveHub,
  } = hubLifecycle;

  const {
    showHubAdmin,
    setShowHubAdmin,
    hubAdminTab,
    setHubAdminTab,
    myRoles,
    setMyRoles,
    myApprovalStatus,
    setMyApprovalStatus,
    adminHubName,
    setAdminHubName,
    adminHubDescription,
    setAdminHubDescription,
    adminHubIcon,
    setAdminHubIcon,
    adminWelcomeLabel,
    adminFarewellLabel,
    setAdminFarewellLabel,
    setAdminWelcomeLabel,
    adminWelcomeInviteUrl,
    setAdminWelcomeInviteUrl,
    adminMembers,
    adminBans,
    adminInvites,
    requireApproval,
    setRequireApproval,
    minSecurityLevel,
    setMinSecurityLevel,
    maxChannelDepth,
    setMaxChannelDepth,
    maxAttachmentBytes,
    setMaxAttachmentBytes,
    hubTimezone,
    setHubTimezone,
    birthdaysEnabled,
    setBirthdaysEnabled,
    nameColorMode,
    setNameColorMode,
    afkChannelId,
    setAfkChannelId,
    afkTimeoutSecs,
    setAfkTimeoutSecs,
    pendingMembers,
    hubListed,
    onHubListedChange,
    isAdmin,
    openHubAdmin,
    openHubAdminInvites,
    handleSaveHubBranding,
    refreshPending,
    handleApproveMember,
    refreshMembers,
    handleKickMember,
    handleBanMember,
    handleMuteMember,
    handleTimeoutMember,
    refreshBans,
    handleUnban,
    refreshInvites,
    handleCreateInvite,
    handleRevokeInvite,
    loadAdminTabData,
  } = useHubAdmin({
    activeHubId,
    hubs,
    setHubs: (updater) => setHubs(updater),
    setError,
    setToast,
  });

  const [assertiveAnnouncement, setAssertiveAnnouncement] = useState("");
  const [voicePoliteAnnouncement, setVoicePoliteAnnouncement] = useState("");
  const voiceAnnounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingVoiceAnnouncementsRef = useRef<string[]>([]);

  const publicKeyRef = useRef<string | null>(null);
  useEffect(() => {
    publicKeyRef.current = publicKey;
  }, [publicKey]);

  const hasActiveHub = hubs.length > 0 && activeHubId !== null;

  // Keep channels in a ref so the WS event handler can check visibility
  // without capturing stale state. Used as the permission gate: messages for
  // channel_ids absent from this list are silently dropped.
  const channelsRef = useRef<Channel[]>([]);

  const firstNotify = useFirstNotify();
  const { setFirstNotify, clearFirstNotify, clearHubFirstNotify } = firstNotify;

  // Chat state
  const [channels, setChannels] = useState<Channel[]>([]);
  useEffect(() => { channelsRef.current = channels; }, [channels]);

  // First-run hub setup wizard (decisions.md 2026-07-25): shown once per hub
  // when an admin lands on an empty channel list. localStorage is fine here —
  // purely cosmetic, same posture as wavvon.seenWelcome/memberSidebarHidden
  // below, not worth a dedicated per-account local_store file+command. The
  // "isAdmin" gate matches the sidebar's own "create channel" entry;
  // loadHubData sets myRoles then channels in the same call, so there's no
  // stale-isAdmin window here.
  const { showHubSetupWizard, closeHubSetupWizard } = useHubSetupWizardGate({
    storageGet: () => localStorage.getItem("wavvon.hubSetupWizardDone"),
    storageSet: (raw) => { localStorage.setItem("wavvon.hubSetupWizardDone", raw); },
    activeHubId,
    isAdmin,
    channelCount: channels.length,
  });

  // Refs kept in App so useTypingIndicators and useChannelMessages can share them.
  const selectedChannelForTypingRef = useRef<Channel | null>(null);
  const selectedConversationForTypingRef = useRef<Conversation | null>(null);

  const typing = useTypingIndicators(selectedChannelForTypingRef, selectedConversationForTypingRef);
  const {
    setTyping,
    clearTyping,
    setDmTyping,
    clearDmTyping,
    clearAllTyping,
    clearAllDmTyping,
  } = typing;

  // Stable getter refs for useDms — avoids capturing stale closures.
  const inputTextRef = useRef("");
  const pendingAttachmentsRef = useRef<Attachment[]>([]);
  const clearInputRef = useRef<() => void>(() => {});
  const clearPendingAttachmentsRef = useRef<() => void>(() => {});

  // Refs that useChannelMessages needs, declared here so they exist before both
  // useDms and useChannelMessages are called.
  const myDisplayNameRef = useRef<string | null>(null);
  const selectedChannelIdRef = useRef<string | null>(null);

  const dms = useDms({
    publicKeyRef,
    activeHubIdRef,
    selectedConversationForTypingRef,
    getActiveHub: () => hubs.find((h) => h.is_active),
    getPendingAttachments: () => pendingAttachmentsRef.current,
    getInputText: () => inputTextRef.current,
    clearInput: () => clearInputRef.current(),
    clearPendingAttachments: () => clearPendingAttachmentsRef.current(),
    setError,
    clearAllDmTyping,
    unreadDms,
    setUnreadDms,
  });
  const {
    view,
    setView,
    viewRef,
    setConversations,
    conversationsRef,
    setSelectedConversation,
    selectedConversationIdRef,
    encryptionWarning,
    setEncryptionWarning,
    loadConversations,
    selectConversation,
    startDmWith,
    onDmEvent,
    onDmMemberChanged,
  } = dms;

  // Ctrl+K quick-switcher palette.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);

  // Above useChannelMessages: the alliance state it wires to the composer now
  // lives here, the way it always has on web.
  const alliances = useAlliances(setError);

  const channelMessages = useChannelMessages({
    activeHubIdRef,
    publicKeyRef,
    myDisplayNameRef,
    channelsRef,
    hubsRef,
    selectedChannelIdRef,
    myPresenceRef,
    effectiveNotifyMode,
    bumpUnread,
    clearUnread,
    setFirstNotify,
    clearFirstNotify,
    clearAllTyping,
    setError,
    setToast,
    selectedAllianceChannel: alliances.selectedAllianceChannel,
    allianceMessages: alliances.allianceMessages,
    setSelectedAllianceChannel: alliances.setSelectedAllianceChannel,
    setAllianceMessages: alliances.setAllianceMessages,
    clearSelectedAllianceChannel: alliances.clearSelectedAllianceChannel,
    selectSharedAllianceChannel: alliances.selectAllianceChannel,
    sendAllianceMessage: alliances.sendAllianceMessage,
  });

  // Keep refs in sync so useTypingIndicators sees the current channel/conv.
  useEffect(() => {
    selectedChannelForTypingRef.current = channelMessages.selectedChannel;
  }, [channelMessages.selectedChannel]);

  // Keep stable getter refs in sync for useDms.
  useEffect(() => { inputTextRef.current = channelMessages.inputText; }, [channelMessages.inputText]);
  useEffect(() => { pendingAttachmentsRef.current = channelMessages.pendingAttachments; }, [channelMessages.pendingAttachments]);
  useEffect(() => { clearInputRef.current = () => channelMessages.setInputText(""); }, [channelMessages.setInputText]);
  useEffect(() => { clearPendingAttachmentsRef.current = () => channelMessages.setPendingAttachments([]); }, [channelMessages.setPendingAttachments]);

  // Keep selectedChannelIdRef in sync (used by WS handlers).
  useEffect(() => {
    selectedChannelIdRef.current = channelMessages.selectedChannel?.id ?? null;
  }, [channelMessages.selectedChannel]);

  // Whether the right-side member list is collapsed. Local-only preference;
  // localStorage is fine since it's purely cosmetic + per-device.
  const [memberSidebarHidden, setMemberSidebarHiddenState] = useState<boolean>(
    () => {
      try {
        return localStorage.getItem("wavvon.memberSidebarHidden") === "1";
      } catch {
        return false;
      }
    },
  );
  function setMemberSidebarHidden(v: boolean) {
    setMemberSidebarHiddenState(v);
    try {
      localStorage.setItem("wavvon.memberSidebarHidden", v ? "1" : "0");
    } catch {}
  }

  // Lightbox: when set, renders a full-screen image overlay. Used by image
  // attachments so clicking opens a zoom view instead of a new browser tab.
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const openImage = (src: string, alt: string) => setLightbox({ src, alt });

  // Right-click on a user: small popover with quick actions.
  const [userContextMenu, setUserContextMenu] = useState<{
    x: number;
    y: number;
    user: User;
  } | null>(null);

  async function handleUserDm(u: User) {
    setUserContextMenu(null);
    if (u.public_key === publicKey) return;
    try {
      const conv = await invoke<Conversation>("create_conversation", {
        members: [u.public_key],
        memberHubs: {},
      });
      const list = await invoke<Conversation[]>("list_conversations");
      setConversations(list);
      setView("dms");
      selectConversation(conv);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleUserAddFriend(u: User) {
    setUserContextMenu(null);
    await handleUserAddFriendFromHook(
      u.public_key,
      publicKey,
      u.display_name || formatPubkey(u.public_key),
    );
  }

  const {
    userAlliances,
    setUserAlliances,
    allianceChannels,
    setAllianceChannels,
    loadAlliances,
  } = alliances;

  const [hubDropdownOpen, setHubDropdownOpen] = useState(false);
  const [showHubStreams, setShowHubStreams] = useState(false);

  // Context menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; channel: Channel } | null>(null);
  const [eventComposerChannelId, setEventComposerChannelId] = useState<string | null>(null);
  const [pollComposerChannelId, setPollComposerChannelId] = useState<string | null>(null);

  const channelCrud = useChannelCrud({
    hubs,
    activeHubId,
    selectedChannel: channelMessages.selectedChannel,
    selectChannel: channelMessages.selectChannel,
    clearSelectedChannel: channelMessages.clearSelectedChannel,
    closeContextMenu: () => setContextMenu(null),
    setChannels,
    setError,
  });

  const {
    setShowCreateChannel,
    setChannelSettingsModal,
    openEditDescription,
    openCreateChannelUnder,
  } = channelCrud;

  // Message edit state — which message id is being edited and its draft
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");

  // Hub users
  const [users, setUsers] = useState<User[]>([]);

  const { slashCommands, loadSlashCommands, clearSlashCommands } = useSlashCommands();

  const [activeBotApps, setActiveBotApps] = useState<Map<string, BotAppLaunchEvent>>(new Map());

  function sendBotAppJoin(botId: string, channelId: string) {
    if (!activeHubId) return;
    invoke("send_hub_ws_raw", {
      payload: JSON.stringify({ type: "bot_app_join", bot_id: botId, channel_id: channelId }),
    }).catch(() => {});
  }

  const pubkeyToName = useMemo(() => {
    const m: Record<string, string | null> = {};
    for (const u of users) m[u.public_key] = u.display_name;
    return m;
  }, [users]);

  // Indexes for mention rendering. knownDisplayNames is the lower-cased set
  // of all display names on this hub so MessageContent can decide which
  // @tokens are real mentions vs just text.
  const knownDisplayNames = useMemo(() => {
    const s = new Set<string>();
    for (const u of users) {
      if (u.display_name) s.add(u.display_name.toLowerCase());
    }
    return s;
  }, [users]);
  const myDisplayName = useMemo(
    () => users.find((u) => u.public_key === publicKey)?.display_name ?? null,
    [users, publicKey]
  );
  useEffect(() => {
    myDisplayNameRef.current = myDisplayName;
  }, [myDisplayName]);

  const voice = useVoice({ activeHubId, selectedChannel: channelMessages.selectedChannel, setError, setToast });

  // Registered so switchAccountGuarded can refuse a mid-voice account switch
  // at the source (defense in depth alongside a disabled Switch button in
  // Settings → Account) — switching while joined to a voice channel is
  // blocked outright, not auto-left on the caller's behalf (mirrors web's
  // App.tsx switch guard, decisions.md "Account switching is an in-place
  // key-remount, guarded, not a reload").
  useEffect(() => {
    setSwitchGuard(() =>
      voice.voiceChannelId ? t("settings.account.accounts.switch_blocked_voice") : null,
    );
    return () => setSwitchGuard(null);
  }, [voice.voiceChannelId, t]);

  const video = useVideo({
    activeHubId,
    voiceChannelId: voice.voiceChannelId,
    publicKey,
    voiceSpeakingPubkeys: voice.speakingPubkeys,
  });

  const whisper = useWhisper({ activeHubId, voiceChannelId: voice.voiceChannelId });
  const soundboard = useSoundboard(voice.voiceChannelId);
  const { chipsByChannel: soundboardChipsByChannel, receiveSoundboardPlayed } = useSoundboardChips();
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
  const [showWhisperPanel, setShowWhisperPanel] = useState(false);
  const [showSearchBar, setShowSearchBar] = useState(false);

  // === Voice move (events.md §7.1/§7.2) ===
  const {
    voiceMoveMenu,
    setVoiceMoveMenu,
    voiceChannelNameHint,
    setVoiceChannelNameHint,
    voiceMovePrompt,
    voiceMoveToast,
    dismissVoiceMoveToast,
    handleRejoinPreviousVoiceChannel,
    handleAcceptVoiceMove,
    handleDeclineVoiceMove,
    onVoiceMovePush,
  } = useVoiceMoveUx({ joinVoice: (id) => void voice.handleVoiceJoin(id) });

  // Web's useVoice clears this on voice-leave (extRef.clearVoiceChannelNameHint);
  // desktop's hook has no ext-callback hook, so the call site clears it directly.
  function leaveVoiceChannel() {
    voice.handleVoiceLeave();
    setVoiceChannelNameHint(null);
  }

  const canMoveMembers = isAdmin || myRoles.some((r) => r.permissions?.includes("move_members"));
  const voiceMoveChannelOptions = useMemo(
    () => moveChannelOptions(channels).filter((c) => c.id !== voiceMoveMenu?.currentChannelId),
    [channels, voiceMoveMenu],
  );

  // Mover's side: right-click "Move to channel…" (events.md §7.1).
  function handleMoveMember(targetPubkey: string, targetChannelId: string, eventId?: string) {
    invoke("send_hub_ws_raw", {
      payload: JSON.stringify({
        type: "voice_move",
        target_pubkey: targetPubkey,
        target_channel_id: targetChannelId,
        ...(eventId ? { event_id: eventId } : {}),
      }),
    }).catch(() => setToast("Not connected"));
  }

  
  const settingsProfile = useSettingsProfile({
    setPublicKey,
    setError,
    setToast,
  });
  const {
    showSettings,
    setShowSettings,
    setTheme,
    setSkin,
    setRecoveryPhrase,
  } = settingsProfile;

  const [showDiscover, setShowDiscover] = useState(false);
  const [showHubBrowser, setShowHubBrowser] = useState(false);
  const [showWelcome, setShowWelcome] = useState<boolean>(() => {
    try {
      return localStorage.getItem("wavvon.seenWelcome") !== "1";
    } catch {
      return true;
    }
  });

  const addHubFlow = useAddHubFlow({
    showWelcome,
    publicKey,
    activeHubId,
    setHubs,
    setActiveHubId,
    setPublicKey,
    setHubScope,
    setPendingSurveyHubId,
    setError,
  });

  const {
    setShowAddHub,
    loading,
    hubUrl,
    setHubUrl,
    inviteCode,
    setInviteCode,
    hubPreview,
    handleHubUrlChange,
    handleAddHub,
  } = addHubFlow;

  const {
    showFriends,
    setShowFriends,
    openFriends,
    handleUserAddFriend: handleUserAddFriendFromHook,
  } = useFriends({ setError, setToast });

  const [hideSilenced, setHideSilenced] = useState(false);
  const [hideBirthdays, setHideBirthdays] = useState(false);

  // Auto-dismiss toast after 5 seconds
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (voice.shareError) setToast(voice.shareError);
  }, [voice.shareError]);

  // ESC closes the settings view (and stops the mic test if one is running)
  useEffect(() => {
    if (!showSettings) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSettings();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSettings, voice.micTesting]);

  // ESC closes the hub admin view
  useEffect(() => {
    if (!showHubAdmin) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowHubAdmin(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showHubAdmin]);

  useEffect(() => {
    if (!showHubAdmin) return;
    loadAdminTabData(hubAdminTab, voice.refreshVoiceMutes);
  }, [showHubAdmin, hubAdminTab]);

  // Surface any error as a toast so the user actually sees it
  // (we removed the always-visible connect screen that used to render it).
  useEffect(() => {
    if (error) setToast(error);
  }, [error]);

  useWsHandlers({
    activeHubIdRef,
    publicKeyRef,
    selectedChannelIdRef,
    selectedConversationIdRef,
    users,
    setUsers,
    myPresenceRef,
    whisperOptoutRef,
    setHubConnected,
    setAssertiveAnnouncement,
    setToast,
    setTyping,
    clearTyping,
    setDmTyping,
    clearDmTyping,
    onDmEvent,
    onDmMemberChanged,
    onHubReconnected,
    scheduleReconnect,
    cancelAllReconnectTimers,
    onVoiceJoined: voice.onVoiceJoined,
    onParticipantJoined: voice.onParticipantJoined,
    onParticipantLeft: voice.onParticipantLeft,
    onMicLevel: voice.onMicLevel,
    onHubErrorVoiceJoin: voice.onHubErrorVoiceJoin,
    pendingVoiceAnnouncementsRef,
    voiceAnnounceTimerRef,
    setVoicePoliteAnnouncement,
    hubs,
    channelsRef,
    onBotAppLaunch: (ev: BotAppLaunchEvent) => {
      setActiveBotApps((prev) => {
        const next = new Map(prev);
        next.set(ev.bot_id, ev);
        return next;
      });
    },
    onBotAppOpen: (ev: BotAppOpenEvent, hubUrl: string) => {
      const label = `mini-app-${ev.bot_id}`;
      invoke("open_mini_app", {
        label,
        url: ev.mini_app_url,
        hubUrl,
        token: ev.session_token,
        channelId: ev.channel_id,
        botId: ev.bot_id,
        requiresCamera: ev.requires_camera,
      }).catch(() => {});
    },
    onBotAppClose: (ev: BotAppCloseEvent) => {
      setActiveBotApps((prev) => {
        const next = new Map(prev);
        next.delete(ev.bot_id);
        return next;
      });
      invoke("close_mini_app", { label: `mini-app-${ev.bot_id}` }).catch(() => {});
    },
    onVoiceMove: onVoiceMovePush,
    onChannelsChanged: () => {
      invoke<Channel[]>("list_channels").then(setChannels).catch(() => {});
    },
    onHubBrandingChanged: () => {
      invoke<{ timezone?: string | null }>("get_hub_branding")
        .then((b) => setActiveHubTimezone(b.timezone ?? null))
        .catch(() => {});
      // The hub's name/icon live in the Rust-side account store, so the
      // sidebar entry only refreshes by re-reading the saved hub list.
      invoke<Hub[]>("list_hubs").then(setHubs).catch(() => {});
    },
    onSoundboardPlayed: receiveSoundboardPlayed,
  });

  async function loadHubData() {
    try {
      const activeHub = hubs.find((h) => h.hub_id === activeHubId) ?? hubs.find((h) => h.is_active);

      // Check lobby scope first — if we're in the lobby, skip loading full hub data.
      if (activeHub) {
        try {
          const lobbyStatus = await invoke<LobbyStatus>("lobby_status", { hubUrl: activeHub.hub_url });
          if (lobbyStatus.status === "lobby") {
            setHubScope((prev) => ({ ...prev, [activeHub.hub_id]: "lobby" }));
            return;
          } else {
            setHubScope((prev) => {
              if (prev[activeHub.hub_id] === "lobby") {
                return { ...prev, [activeHub.hub_id]: "member" };
              }
              return prev;
            });
          }
        } catch {
          // lobby endpoint absent means not a lobby hub; continue normally
        }
      }

      // Pull /me FIRST. If we're pending approval, the rest of the calls
      // would just 403 and bury the user under a wall of error toasts.
      let me: MeInfo | null = null;
      try {
        me = await invoke<MeInfo>("get_me");
        setMyRoles(me.roles);
        setMyApprovalStatus(me.approval_status);
      } catch {
        setMyRoles([]);
        setMyApprovalStatus("unknown");
      }

      if (me?.approval_status === "pending") {
        // Reset everything else; show the landing screen.
        setChannels([]);
        setUsers([]);
        setConversations([]);
        channelMessages.setSelectedAllianceChannel(null);
        channelMessages.setMessages([]);
        setUserAlliances([]);
        setAllianceChannels({});
        return;
      }

      invoke<{ timezone?: string | null }>("get_hub_branding")
        .then((b) => setActiveHubTimezone(b.timezone ?? null))
        .catch(() => setActiveHubTimezone(null));

      const ch = await invoke<Channel[]>("list_channels");
      setChannels(ch);
      const u = await invoke<User[]>("list_users");
      setUsers(u);
      const c = await invoke<Conversation[]>("list_conversations");
      setConversations(c);
      // Reset selection when switching hub
      channelMessages.setSelectedAllianceChannel(null);
      channelMessages.setAllianceMessages([]);
      channelMessages.setMessages([]);
      await loadAlliances();
    } catch (e) {
      setError(String(e));
    }
  }

  const { updateInfo, dismissUpdateInfo } = useUpdateBanner();

  // Auto-connect saved hubs on app start + load our own public key once
  useEffect(() => {
    (async () => {
      // Apply persisted theme/skin as early as possible to avoid a flash.
      try {
        const appearance = await invoke<{ slot: string; skin?: WavvonSkin | null }>("load_appearance");
        if (appearance.slot === "custom" && appearance.skin) {
          const s = appearance.skin;
          setSkin(s);
          setTheme("custom");
          document.documentElement.dataset.theme = s.base;
          applySkinTokens(s);
        } else {
          const valid =
            appearance.slot === "calm" || appearance.slot === "classic" ||
            appearance.slot === "linear" || appearance.slot === "light"
              ? (appearance.slot as ThemeId)
              : "calm";
          setTheme(valid);
          document.documentElement.dataset.theme = valid;
        }
      } catch {
        try {
          const profile = await invoke<{ theme?: string | null }>("get_profile");
          const t = (profile.theme ?? "calm") as ThemeId;
          const valid = t === "calm" || t === "classic" || t === "linear" || t === "light" ? t : "calm";
          setTheme(valid);
          document.documentElement.dataset.theme = valid;
        } catch {
          document.documentElement.dataset.theme = "calm";
        }
      }
      try {
        const key = await invoke<string>("get_my_public_key");
        setPublicKey(key);
      } catch (e) {
        console.error("Failed to load identity:", e);
      }
      // Ask for notification permission once on launch. The browser
      // Notification API works inside Tauri 2 webviews; we silently fall
      // back to no notifications if the user denies.
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "default"
      ) {
        try {
          await Notification.requestPermission();
        } catch {}
      }
      try {
        const allHubs = await invoke<Hub[]>("auto_connect_saved");
        if (allHubs.length > 0) {
          setHubs(allHubs);
          const active = allHubs.find((h) => h.is_active) ?? allHubs[0];
          setActiveHubId(active.hub_id);
          setShowWelcome(false);
        }
      } catch (e) {
        console.error("Auto-connect failed:", e);
      }
      invoke("publish_dh_key").catch((e) =>
        console.warn("Failed to publish DH key:", e)
      );
    })();
  }, []);

  useEffect(() => {
    if (hubs.length > 0) setShowWelcome(false);
  }, [hubs.length]);

  // Who we are is a per-hub answer, and the first read happens before any hub
  // is connected. A hub that met this identity through its self-signed cert
  // seats the master rather than this device's key (see the Rust
  // HubSession::canonical_pubkey), and every "is this mine" in the UI —
  // message authorship, the other member of a DM, the roster row that is us —
  // compares against this value.
  useEffect(() => {
    if (!activeHubId) return;
    invoke<string>("get_my_public_key")
      .then(setPublicKey)
      .catch(() => {});
  }, [activeHubId]);

  // Ask for a display name once, on the first hub this identity joins with
  // none. Without it a fresh desktop identity sat in every roster as a slice
  // of its pubkey: the nickname step and this prompt were both web-only
  // (found 2026-09-06 by the web-desktop harness, which could not find its own
  // member by name).
  const [showDisplayNamePrompt, setShowDisplayNamePrompt] = useState(false);
  const me = users.find((u) => u.public_key === publicKey);
  useEffect(() => {
    if (hubs.length !== 1 || !me || me.display_name) return;
    // A default profile means the user already said who they want to be —
    // apply it instead of asking again, the same way web does.
    void loadDefaultProfileAsync()
      .then((def) => {
        if (def?.display_name?.trim()) return saveDisplayName(def.display_name.trim());
        setShowDisplayNamePrompt(true);
      })
      .catch(() => setShowDisplayNamePrompt(true));
    // Only when the answer changes, not on every roster update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.display_name, hubs.length]);

  async function saveDisplayName(name: string) {
    setShowDisplayNamePrompt(false);
    const hubUrl = hubs.find((h) => h.hub_id === activeHubId)?.hub_url;
    if (!hubUrl) return;
    try {
      await invoke("update_my_profile_on_hub", { hubUrl, profile: { display_name: name } });
      setUsers((prev) =>
        prev.map((u) => (u.public_key === publicKey ? { ...u, display_name: name } : u)),
      );
    } catch (e) {
      setError(String(e));
    }
  }

  // Suppress the webview's default right-click menu (Reload / Inspect /
  // Back). Tauri 2 still enables it by default and a stray right-click
  // anywhere on the chrome would let the user accidentally reload the app.
  // Components that want their own context menu (channel rows, messages,
  // user list items) call e.preventDefault() in their onContextMenu, which
  // also stops the browser default — so they keep working unchanged.
  // Native menus stay available inside text inputs so copy/paste isn't
  // broken.
  useEffect(() => {
    const onContext = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable ||
        target.closest("[data-allow-context-menu]")
      ) {
        return;
      }
      e.preventDefault();
    };
    document.addEventListener("contextmenu", onContext);
    return () => document.removeEventListener("contextmenu", onContext);
  }, []);

  // Auto-select the first text-channel-style room when a hub loads, so
  // the user lands on something readable instead of an empty content
  // pane. Only fires when nothing's selected; user-driven channel
  // changes don't re-trigger because selectedChannel is set.
  useEffect(() => {
    if (channelMessages.selectedChannel) return;
    if (channels.length === 0) return;
    // Skip categories and banner channels — pick the first interactive leaf.
    const firstLeaf = channels.find((c) => !c.is_category && c.channel_type !== "banner");
    if (firstLeaf) {
      channelMessages.selectChannel(firstLeaf);
    }
    // selectChannel is stable in scope but eslint can't prove that;
    // listing it would re-trigger every render. Channels is the real
    // signal we want to watch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, channelMessages.selectedChannel]);

  // Reload data when switching hubs
  useEffect(() => {
    if (activeHubId) {
      loadHubData();
      const hub = hubs.find((h) => h.hub_id === activeHubId);
      if (hub) loadSlashCommands(hub.hub_url);
      else clearSlashCommands();
    } else {
      // No active hub — clear approval state so the next switch starts fresh.
      setMyApprovalStatus("unknown");
      clearSlashCommands();
    }
  }, [activeHubId]);

  // Refresh users every 10 seconds for active hub
  useEffect(() => {
    if (!hasActiveHub) return;
    const interval = setInterval(async () => {
      try {
        const u = await invoke<User[]>("list_users");
        setUsers(u);
      } catch {}
    }, 10000);
    return () => clearInterval(interval);
  }, [hasActiveHub, activeHubId]);

  async function startDmWithAndClose(targetKey: string, targetHubUrl?: string | null) {
    await startDmWith(targetKey, targetHubUrl);
    setShowFriends(false);
  }

  async function openSettings() {
    setShowSettings(true);
    setRecoveryPhrase(null);
    try {
      const profile = await invoke<{ theme?: string | null }>("get_profile");
      const t = profile.theme;
      if (t === "calm" || t === "classic" || t === "linear" || t === "light") {
        setTheme(t);
      }
    } catch {}

    await voice.loadVoiceSettings();
  }

  function handleDiscoverJoin(url: string, code: string) {
    setHubUrl(url);
    setInviteCode(code);
    setShowAddHub(true);
    setShowDiscover(false);
  }

  async function closeSettings() {
    if (voice.micTesting) await voice.toggleMicTest();
    setShowSettings(false);
  }

  function dismissWelcome() {
    try {
      localStorage.setItem("wavvon.seenWelcome", "1");
    } catch {}
    setShowWelcome(false);
  }

  const channelTree = useMemo(() => {
    return buildChannelTree(channels);
  }, [channels]);

  const silencedChannelIds = useMemo(() => {
    if (!activeHubId || !hideSilenced) return new Set<string>();
    return new Set(
      channels
        .filter((c) => !c.is_category && effectiveNotifyMode(activeHubId, c.id) === "silent")
        .map((c) => c.id)
    );
  }, [activeHubId, hideSilenced, channels, channelNotifyMode, hubNotifyMode]);

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    // Client-side cycle guard: can't drop a node into its own descendant.
    const forbidden = descendantIds(channelTree, activeId);
    if (forbidden.has(overId)) return;

    // Determine the new parent: dropping on the top/bottom edge of an item
    // reorders as a sibling; only the middle band of a category nests
    // (nested-channels-ux drag&drop fix — dropping anywhere on a category
    // used to always nest, so root-level items could never be reordered
    // around one).
    const allFlat = flattenTree(channelTree);
    const activeFlat = allFlat.find((n) => n.node.id === activeId);
    const overFlat = allFlat.find((n) => n.node.id === overId);
    if (!activeFlat || !overFlat) return;

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

    // Optimistic parent update so the reorder below sees the new shape.
    const channelsWithNewParent = parentChanged
      ? channels.map((c) => (c.id === activeId ? { ...c, parent_id: newParentId } : c))
      : channels;

    // Reorder within the flat global list.
    const sorted = [...channelsWithNewParent].sort((a, b) => a.display_order - b.display_order);
    const oldIndex = sorted.findIndex((c) => c.id === activeId);
    const newIndex = sorted.findIndex((c) => c.id === overId);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(sorted, oldIndex, newIndex);
    setChannels(reordered.map((c, i) => ({ ...c, display_order: i })));

    try {
      if (parentChanged) {
        await invoke("move_channel", { channelId: activeId, parentId: newParentId });
      }
      await invoke("reorder_channels", { channelIds: reordered.map((c) => c.id) });
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleHubSetupWizardComplete(firstChannelId: string | null) {
    if (!activeHubId) return;
    closeHubSetupWizard(activeHubId);
    try {
      const list = await invoke<Channel[]>("list_channels");
      setChannels(list);
      const first = firstChannelId ? list.find((c) => c.id === firstChannelId) : undefined;
      if (first) channelMessages.selectChannel(first);
    } catch { /* cosmetic refresh only */ }
  }

  function openContextMenu(e: React.MouseEvent, channel: Channel) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, channel });
  }

  // Mirrors ContentArea.tsx's createEvent/onCreatePoll wrappers (same
  // create_event_hub / create_poll commands) — App-level composer instances
  // need their own copies since ContentArea's are private to that component.
  function createEventForComposer(payload: CreateEventPayload): Promise<HubEvent> {
    const hubUrl = hubs.find((h) => h.hub_id === activeHubId)?.hub_url ?? "";
    return invoke<HubEvent>("create_event_hub", {
      hubUrl,
      title: payload.title,
      description: payload.description ?? "",
      startsAt: payload.starts_at,
      endsAt: payload.ends_at ?? null,
      channelId: payload.channel_id,
      location: payload.location ?? null,
      reminderMinutes: payload.reminder_minutes ?? null,
      slots: payload.slots ?? [],
      hubWide: payload.hub_wide ?? false,
      propagateToChildren: payload.propagate_to_children ?? false,
    });
  }

  async function createPollForComposer(channelId: string, question: string, options: string[]): Promise<Poll> {
    const hubUrl = hubs.find((h) => h.hub_id === activeHubId)?.hub_url ?? "";
    const raw = await invoke<{
      id: string; channel_id: string; creator_pubkey: string; question: string;
      options: string; ends_at: number | null; created_at: number;
    }>("create_poll", { hubUrl, channelId, question, options, closesAt: null });
    const rawOptions: Array<{ id: string; text: string }> = JSON.parse(raw.options);
    return {
      id: raw.id,
      channel_id: raw.channel_id,
      question: raw.question,
      options: rawOptions.map((o) => ({ id: o.id, text: o.text, vote_count: 0, voted: false })),
      total_votes: 0,
      created_by: raw.creator_pubkey,
      created_at: raw.created_at,
      ends_at: raw.ends_at,
      is_deleted: false,
    };
  }

  useEffect(() => {
    function isTextInput(el: Element | null): boolean {
      if (!el) return false;
      const tag = (el as HTMLElement).tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable;
    }

    function onKey(e: KeyboardEvent) {
      const meta = e.ctrlKey || e.metaKey;
      const inText = isTextInput(document.activeElement);

      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }

      if (meta && e.key === "/") {
        e.preventDefault();
        setShowKeyboardShortcuts((v) => !v);
        return;
      }

      if (meta && e.key === ",") {
        e.preventDefault();
        openSettings();
        return;
      }

      if (meta && e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        voice.toggleSelfMute();
        return;
      }

      if (meta && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        voice.toggleSelfDeafen();
        return;
      }

      if (meta && e.shiftKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        if (voice.voiceChannelId) {
          leaveVoiceChannel();
        } else if (channelMessages.selectedChannel && !channelMessages.selectedChannel.is_category) {
          voice.handleVoiceJoin(channelMessages.selectedChannel);
        }
        return;
      }

      if (meta && e.key === "ArrowUp") {
        e.preventDefault();
        const idx = hubs.findIndex((h) => h.hub_id === activeHubId);
        if (idx > 0) {
          const prev = hubs[idx - 1];
          handleSwitchHub(prev.hub_id);
          setView("channels");
        }
        return;
      }

      if (meta && e.key === "ArrowDown") {
        e.preventDefault();
        const idx = hubs.findIndex((h) => h.hub_id === activeHubId);
        if (idx >= 0 && idx < hubs.length - 1) {
          const next = hubs[idx + 1];
          handleSwitchHub(next.hub_id);
          setView("channels");
        }
        return;
      }

      if (e.altKey && e.key === "ArrowUp") {
        e.preventDefault();
        if (view === "channels" && activeHubId) {
          const unreadSet = unreadByChannel[activeHubId] ?? {};
          const unreadChannels = channels.filter((c) => !c.is_category && unreadSet[c.id]);
          if (unreadChannels.length > 0) {
            const idx = channelMessages.selectedChannel
              ? unreadChannels.findIndex((c) => c.id === channelMessages.selectedChannel!.id)
              : -1;
            const prev = idx > 0 ? unreadChannels[idx - 1] : unreadChannels[unreadChannels.length - 1];
            channelMessages.selectChannel(prev);
          }
        }
        return;
      }

      if (e.altKey && e.key === "ArrowDown") {
        e.preventDefault();
        if (view === "channels" && activeHubId) {
          const unreadSet = unreadByChannel[activeHubId] ?? {};
          const unreadChannels = channels.filter((c) => !c.is_category && unreadSet[c.id]);
          if (unreadChannels.length > 0) {
            const idx = channelMessages.selectedChannel
              ? unreadChannels.findIndex((c) => c.id === channelMessages.selectedChannel!.id)
              : -1;
            const next = idx >= 0 && idx < unreadChannels.length - 1
              ? unreadChannels[idx + 1]
              : unreadChannels[0];
            channelMessages.selectChannel(next);
          }
        }
        return;
      }

      if (meta && e.key.toLowerCase() === "f" && !inText) {
        e.preventDefault();
        channelMessages.setSearchOpen(true);
        return;
      }

      if (e.key === "/" && !inText && !meta) {
        e.preventDefault();
        channelMessages.messageInputRef.current?.focus();
        return;
      }

      if (e.key === "Escape") {
        if (contextMenu) { setContextMenu(null); return; }
        if (paletteOpen) { setPaletteOpen(false); return; }
        if (channelMessages.replyTarget) { channelMessages.setReplyTarget(null); return; }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hubs, activeHubId, channelMessages.selectedChannel, channels, view, voice, unreadByChannel, contextMenu, paletteOpen, channelMessages.replyTarget]);

  return (
    <div className="app">
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
      {toast && (
        <div className="toast" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
      {updateInfo && (
        <UpdateBanner
          version={updateInfo.version}
          notes={updateInfo.notes}
          onDismiss={dismissUpdateInfo}
        />
      )}
      <>
        {showHubAdmin ? (
          <HubAdminContainer
            tab={hubAdminTab}
            onTab={setHubAdminTab}
            onClose={() => setShowHubAdmin(false)}
            hubName={adminHubName}
            onHubNameChange={setAdminHubName}
            hubDescription={adminHubDescription}
            onHubDescriptionChange={setAdminHubDescription}
            hubIcon={adminHubIcon}
            onHubIconChange={setAdminHubIcon}
            requireApproval={requireApproval}
            onRequireApprovalChange={setRequireApproval}
            minSecurityLevel={minSecurityLevel}
            onMinSecurityLevelChange={setMinSecurityLevel}
            maxChannelDepth={maxChannelDepth}
            maxAttachmentBytes={maxAttachmentBytes}
            onMaxAttachmentBytesChange={setMaxAttachmentBytes}
            onMaxChannelDepthChange={setMaxChannelDepth}
            welcomeLabel={adminWelcomeLabel}
            onWelcomeLabelChange={setAdminWelcomeLabel}
            farewellLabel={adminFarewellLabel}
            onFarewellLabelChange={setAdminFarewellLabel}
            welcomeInviteUrl={adminWelcomeInviteUrl}
            onWelcomeInviteUrlChange={setAdminWelcomeInviteUrl}
            timezone={hubTimezone}
            onTimezoneChange={setHubTimezone}
            birthdaysEnabled={birthdaysEnabled}
            onBirthdaysEnabledChange={setBirthdaysEnabled}
            nameColorMode={nameColorMode}
            onNameColorModeChange={setNameColorMode}
            afkChannelId={afkChannelId}
            onAfkChannelIdChange={setAfkChannelId}
            afkTimeoutSecs={afkTimeoutSecs}
            onAfkTimeoutSecsChange={setAfkTimeoutSecs}
            onSave={handleSaveHubBranding}
            hubListed={hubListed}
            onHubListedChange={onHubListedChange}
            pendingMembers={pendingMembers}
            onApproveMember={handleApproveMember}
            members={adminMembers}
            onKickMember={handleKickMember}
            onBanMember={handleBanMember}
            onMuteMember={handleMuteMember}
            onTimeoutMember={handleTimeoutMember}
            onVoiceMuteMember={voice.handleVoiceMuteMember}
            onVoiceUnmuteMember={voice.handleVoiceUnmuteMember}
            voiceMutedKeys={voice.voiceMutedKeys}
            onMemberRolesChanged={() => refreshMembers()}
            bans={adminBans}
            onUnban={handleUnban}
            invites={adminInvites}
            hubs={hubs}
            activeHubId={activeHubId}
            publicKey={publicKey}
            myRoles={myRoles}
            isAdmin={isAdmin}
            soundboardActions={soundboard.soundboardActions}
            onCreateInvite={handleCreateInvite}
            onRevokeInvite={handleRevokeInvite}
            channels={channels}
          />
        ) : showSettings ? (
          <SettingsPageContainer
            onClose={closeSettings}
            hubs={hubs}
            activeHubId={activeHubId}
            isAdmin={isAdmin}
            publicKey={publicKey}
            blockedUsers={blockedUsers}
            ignoredUsers={ignoredUsers}
            onUnblock={toggleBlockUser}
            onUnignore={toggleIgnoreUser}
            knownNames={pubkeyToName}
            hideBirthdays={hideBirthdays}
            onToggleHideBirthdays={() => setHideBirthdays((v) => !v)}
            voice={voice}
            video={video}
            channelMessages={channelMessages}
            settingsProfile={settingsProfile}
          />
        ) : (
          <div className="main-layout">
            <HubSidebar
              hubs={hubs}
              activeHubId={activeHubId}
              view={view}
              showDiscover={showDiscover}
              unreadDms={unreadDms}
              unreadByHub={unreadByHub}
              pingByHub={pingByHub}
              hubNotifyMode={hubNotifyMode}
              lobbyHubIds={lobbyHubIds}
              hasActiveHub={hasActiveHub}
              onSwitchToDms={() => { setView("dms"); if (hasActiveHub) loadConversations(); }}
              onSwitchHub={(hubId) => { handleSwitchHub(hubId); setView("channels"); setShowDiscover(false); }}
              onRemoveHub={handleRemoveHub}
              onSetHubNotifyMode={setHubMode}
              onHubReorder={handleHubReorder}
              onAddHub={() => setShowAddHub(true)}
              onDiscover={() => setShowDiscover((v) => !v)}
            />
            {showDiscover && DISCOVERY_URL ? (
              <DiscoverPage
                onClose={() => setShowDiscover(false)}
                onJoinHub={handleDiscoverJoin}
                fetchUrl={(url) => fetchWithTimeout(url)}
                directoryUrl={DISCOVERY_URL}
              />
            ) : showHubBrowser ? (
              <HubBrowser
                onClose={() => setShowHubBrowser(false)}
                onJoinHub={(url, code) => {
                  setHubUrl(url);
                  setInviteCode(code);
                  setShowHubBrowser(false);
                  setShowAddHub(true);
                }}
              />
            ) : !hasActiveHub ? (
              showWelcome ? (
                <WelcomeScreen
                  hubUrl={hubUrl}
                  onHubUrlChange={handleHubUrlChange}
                  hubPreview={hubPreview}
                  loading={loading}
                  error={error}
                  onJoin={() => handleAddHub()}
                  onBrowse={DISCOVERY_URL ? () => setShowDiscover(true) : undefined}
                  onCheckHubUrl={() => setShowHubBrowser(true)}
                  onDismiss={dismissWelcome}
                />
              ) : (
                <div className="empty-state">
                  <p className="muted">{t("app.no_hubs")}</p>
                  <button className="primary" onClick={() => setShowAddHub(true)}>
                    {t("app.add_hub")}
                  </button>
                </div>
              )
            ) : activeHubId && hubScope[activeHubId] === "lobby" && publicKey ? (
              <Lobby
                hubId={activeHubId}
                hubName={hubs.find((h) => h.hub_id === activeHubId)?.hub_name ?? ""}
                pubkeyHex={publicKey}
                actions={{
                  getStatus: () => invoke<LobbyStatus>("lobby_status", { hubUrl: hubs.find((h) => h.hub_id === activeHubId)?.hub_url ?? "" }),
                  getWelcome: () => invoke<{ welcome_md: string }>("lobby_get_welcome", { hubUrl: hubs.find((h) => h.hub_id === activeHubId)?.hub_url ?? "" }),
                  submitProof: (powProof) => invoke<{ promoted: boolean; new_level: number }>("lobby_submit_proof", { hubUrl: hubs.find((h) => h.hub_id === activeHubId)?.hub_url ?? "", powProof }),
                }}
                onPromoted={() => {
                  setHubScope((prev) => ({ ...prev, [activeHubId]: "member" }));
                  loadHubData();
                  setToast(t("app.welcome_toast", {
                    hub: hubs.find((h) => h.hub_id === activeHubId)?.hub_name ?? t("app.the_hub"),
                  }));
                  const resolvedUrl = hubs.find((h) => h.hub_id === activeHubId)?.hub_url ?? "";
                  invoke<{ id: string } | null>("survey_current", { hubUrl: resolvedUrl })
                    .then((survey) => { if (survey) setPendingSurveyHubId(activeHubId); })
                    .catch(() => {});
                }}
              />
            ) : myApprovalStatus === "pending" ? (
              <div className="empty-state pending-approval">
                <div className="pending-approval-icon">⏳</div>
                <h1>{t("app.approval.title")}</h1>
                <p>
                  {t("app.approval.hub_requires", {
                    hub: hubs.find((h) => h.hub_id === activeHubId)?.hub_name
                      ?? t("app.approval.this_hub"),
                  })}
                </p>
                <p className="muted">{t("app.approval.wait_hint")}</p>
                <button onClick={loadHubData} className="primary">
                  {t("app.approval.check_again")}
                </button>
                {hubs.length > 1 && (
                  <p className="muted" style={{ marginTop: "var(--space-4)" }}>
                    {t("app.approval.switch_hint")}
                  </p>
                )}
              </div>
            ) : (
              <>
                <ChannelSidebarContainer
                  view={view}
                  soundboardChipsByChannel={soundboardChipsByChannel}
                  whisperReplyBind={whisperReplyBind}
                  onSetWhisperReplyBind={setWhisperReplyBind}
                  channels={channels}
                  users={users}
                  publicKey={publicKey}
                  isAdmin={isAdmin}
                  myRoles={myRoles}
                  collapsedCategories={collapsedCategories}
                  onToggleCategoryCollapsed={toggleCategoryCollapsed}
                  voiceChannelNameHint={voiceChannelNameHint}
                  setVoiceMoveMenu={setVoiceMoveMenu}
                  hubDropdownOpen={hubDropdownOpen}
                  setHubDropdownOpen={setHubDropdownOpen}
                  hideSilenced={hideSilenced}
                  setHideSilenced={setHideSilenced}
                  silencedChannelIds={silencedChannelIds}
                  userAlliances={userAlliances}
                  allianceChannels={allianceChannels}
                  channelTree={channelTree}
                  effectiveNotifyMode={effectiveNotifyMode}
                  clearHubFirstNotify={clearHubFirstNotify}
                  openHubAdmin={openHubAdmin}
                  openHubAdminInvites={openHubAdminInvites}
                  setShowQuickInvite={setShowQuickInvite}
                  openCreateChannelUnder={openCreateChannelUnder}
                  onChannelContextMenu={openContextMenu}
                  setShowCreateChannel={setShowCreateChannel}
                  setChannelSettingsModal={setChannelSettingsModal}
                  leaveVoiceChannel={leaveVoiceChannel}
                  canMoveMembers={canMoveMembers}
                  openFriends={openFriends}
                  openSettings={openSettings}
                  onDragEnd={handleDragEnd}
                  setShowSearchBar={setShowSearchBar}
                  myPresence={myPresence}
                  onSetStatus={handleSetStatus}
                  showWhisperPanel={showWhisperPanel}
                  setShowWhisperPanel={setShowWhisperPanel}
                  voice={voice}
                  video={video}
                  whisper={whisper}
                  soundboard={soundboard}
                  notifyPrefs={notifyPrefs}
                  hubLifecycle={hubLifecycle}
                  channelMessages={channelMessages}
                  unreadCounts={unreadCounts}
                  dms={dms}
                />
                {showSearchBar && (
                  <SearchBar
                    onSearch={(q) => invoke<GlobalSearchResult[]>("search_messages_global", { q })}
                    onClose={() => setShowSearchBar(false)}
                    onNavigate={(channelId, _messageId) => {
                      const ch = channels.find((c) => c.id === channelId);
                      if (ch) channelMessages.selectChannel(ch);
                      setShowSearchBar(false);
                    }}
                  />
                )}
                {voiceMoveToast && (
                  <VoiceMoveToast
                    channelName={voiceMoveToast.channelName}
                    canRejoin={voiceMoveToast.sourceChannelId !== null}
                    onRejoin={handleRejoinPreviousVoiceChannel}
                    onDismiss={dismissVoiceMoveToast}
                  />
                )}
                {voiceMovePrompt && (
                  <VoiceMovePromptModal
                    channelName={voiceMovePrompt.targetChannelName}
                    onAccept={handleAcceptVoiceMove}
                    onDecline={handleDeclineVoiceMove}
                  />
                )}
                {voiceMoveMenu && (
                  <VoiceMoveMenu
                    displayName={voiceMoveMenu.displayName}
                    position={voiceMoveMenu.position}
                    channels={voiceMoveChannelOptions}
                    onMove={(channelId) => { handleMoveMember(voiceMoveMenu.pubkey, channelId); setVoiceMoveMenu(null); }}
                    onClose={() => setVoiceMoveMenu(null)}
                  />
                )}
                {(video.videoEnabled || video.remoteStreams.size > 0) && (
                  <VideoGrid
                    tiles={buildVideoTiles(
                      video.remoteStreams,
                      video.videoPubkeys,
                      users,
                      voice.speakingPubkeys,
                      video.pinnedPubkey,
                    )}
                    selfStream={video.processedStream}
                    selfName={myDisplayName ?? t("voice.pip.you")}
                    onPin={video.setPinnedPubkey}
                    onUnpin={() => video.setPinnedPubkey(null)}
                  />
                )}
                {channelMessages.selectedChannel && (() => {
                  const channelId = channelMessages.selectedChannel.id;
                  const cards = Array.from(activeBotApps.values()).filter(
                    (e) => e.channel_id === channelId
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
                <ContentAreaContainer
                  view={view}
                  channels={channels}
                  users={users}
                  publicKey={publicKey}
                  blockedUsers={blockedUsers}
                  ignoredUsers={ignoredUsers}
                  knownDisplayNames={knownDisplayNames}
                  myDisplayName={myDisplayName}
                  isAdmin={isAdmin}
                  myRoles={myRoles}
                  memberSidebarHidden={memberSidebarHidden}
                  setMemberSidebarHidden={setMemberSidebarHidden}
                  hideBirthdays={hideBirthdays}
                  openEditDescription={openEditDescription}
                  setUserContextMenu={setUserContextMenu}
                  slashCommands={slashCommands}
                  openImage={openImage}
                  setToast={setToast}
                  setError={setError}
                  showHubStreams={showHubStreams}
                  setShowHubStreams={setShowHubStreams}
                  canMoveMembers={canMoveMembers}
                  handleMoveMember={handleMoveMember}
                  voice={voice}
                  hubLifecycle={hubLifecycle}
                  hubConnections={hubConnections}
                  typing={typing}
                  channelMessages={channelMessages}
                  dms={dms}
                  firstNotify={firstNotify}
                />
              </>
            )}
          </div>
        )}

        {showDisplayNamePrompt && (
          <DisplayNamePrompt
            onSave={saveDisplayName}
            onSkip={() => setShowDisplayNamePrompt(false)}
          />
        )}

        <AppModals
          addHub={addHubFlow}
          channelCrud={channelCrud}
          voice={voice}
          hubs={hubs}
          activeHubId={activeHubId}
          channels={channels}
          users={users}
          publicKey={publicKey}
          isAdmin={isAdmin}
          myRoles={myRoles}
          error={error}
          setToast={setToast}
          setShowHubBrowser={setShowHubBrowser}
          pendingSurveyHubId={pendingSurveyHubId}
          setPendingSurveyHubId={setPendingSurveyHubId}
          setMyApprovalStatus={setMyApprovalStatus}
          showQuickInvite={showQuickInvite}
          setShowQuickInvite={setShowQuickInvite}
          showFriends={showFriends}
          setShowFriends={setShowFriends}
          startDmWithAndClose={startDmWithAndClose}
          eventComposerChannelId={eventComposerChannelId}
          setEventComposerChannelId={setEventComposerChannelId}
          pollComposerChannelId={pollComposerChannelId}
          setPollComposerChannelId={setPollComposerChannelId}
          createEventForComposer={createEventForComposer}
          createPollForComposer={createPollForComposer}
          contextMenu={contextMenu}
          setContextMenu={setContextMenu}
          effectiveNotifyMode={effectiveNotifyMode}
          setChannelMode={setChannelMode}
          showHubSetupWizard={showHubSetupWizard}
          closeHubSetupWizard={closeHubSetupWizard}
          handleHubSetupWizardComplete={handleHubSetupWizardComplete}
          paletteOpen={paletteOpen}
          setPaletteOpen={setPaletteOpen}
          onSelectChannel={channelMessages.selectChannel}
          userContextMenu={userContextMenu}
          setUserContextMenu={setUserContextMenu}
          blockedUsers={blockedUsers}
          ignoredUsers={ignoredUsers}
          refreshMembers={refreshMembers}
          handleUserDm={handleUserDm}
          handleUserAddFriend={handleUserAddFriend}
          toggleBlockUser={toggleBlockUser}
          toggleIgnoreUser={toggleIgnoreUser}
          handleDiscoverJoin={handleDiscoverJoin}
          lightbox={lightbox}
          setLightbox={setLightbox}
          encryptionWarning={encryptionWarning}
          showKeyboardShortcuts={showKeyboardShortcuts}
          setShowKeyboardShortcuts={setShowKeyboardShortcuts}
        />

      </>
    </div>
  );
}

export default App;
