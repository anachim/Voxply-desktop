import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import {
  AddHubModal,
  ChannelContextMenu,
  ChannelSettingsModal,
  EditDescriptionModal,
  EventComposer,
  FriendsModal,
  HubSetupWizard,
  KeyboardShortcuts,
  PollComposer,
  QuickInviteModal,
  UserContextMenu,
  type CreateEventPayload,
  type HubEvent,
  type HubIcon,
  type Poll,
  EncryptionWarningModal,
} from "@wavvon/ui";
import type {
  Channel,
  ForumTagDef,
  Friend,
  Hub,
  InviteInfo,
  MemberAdminInfo,
  NotifyMode,
  PublicHubProfile,
  RoleInfo,
  SurveySubmitResult,
  User,
} from "../types";
import { DISCOVERY_URL } from "../constants";
import type { useAddHubFlow } from "../hooks/useAddHubFlow";
import type { useChannelCrud } from "../hooks/useChannelCrud";
import type { useVoice } from "../hooks/useVoice";
import type { EncryptionWarning } from "@wavvon/ui";
import { Lightbox } from "./Lightbox";
import { BannerEditModal } from "./BannerEditModal";
import { ScreenShareModal } from "./ScreenShareModal";
import { ScreenShareOverlay } from "./ScreenShareOverlay";
import { ChannelPalette } from "./ChannelPalette";
import { BotChallenge } from "./BotChallenge";
import { SurveyComponent } from "./Survey";

// Every modal, overlay and context menu the app can put over itself.
//
// They used to sit at the bottom of App.tsx, ~275 lines of `{showX && <XModal/>}`
// between the layout and the closing tag — the desktop twin of the move that
// left web's App.tsx on 2026-08-31. Nothing here holds state: each block reads a
// flag and a handful of handlers, which is what makes them movable.
//
// Where a hook already owns a cluster of the values (add-hub, channel CRUD,
// voice) the whole hook return travels as one prop instead of being flattened
// into thirty: the same type safety through `ReturnType`, far less prop plumbing
// to keep in sync. The JSX below is the original text unchanged apart from those
// prefixes — a move, not a rewrite, and reviewable as one.
export interface AppModalsProps {
  // Hook bundles
  addHub: ReturnType<typeof useAddHubFlow>;
  channelCrud: ReturnType<typeof useChannelCrud>;
  voice: ReturnType<typeof useVoice>;

  // Shared context
  hubs: Hub[];
  activeHubId: string | null;
  channels: Channel[];
  users: User[];
  publicKey: string | null;
  isAdmin: boolean;
  myRoles: RoleInfo[];
  error: string | null;
  setToast: (v: string | null) => void;

  // Add a hub / bot challenge / approval survey
  setShowHubBrowser: (v: boolean) => void;
  pendingSurveyHubId: string | null;
  setPendingSurveyHubId: (v: string | null) => void;
  setMyApprovalStatus: (v: "pending") => void;

  // Invites and friends
  showQuickInvite: boolean;
  setShowQuickInvite: (v: boolean) => void;
  showFriends: boolean;
  setShowFriends: (v: boolean) => void;
  startDmWithAndClose: (targetKey: string, targetHubUrl?: string | null) => void | Promise<void>;

  // Composers
  eventComposerChannelId: string | null;
  setEventComposerChannelId: (v: string | null) => void;
  pollComposerChannelId: string | null;
  setPollComposerChannelId: (v: string | null) => void;
  createEventForComposer: (payload: CreateEventPayload) => Promise<HubEvent>;
  createPollForComposer: (channelId: string, question: string, options: string[]) => Promise<Poll>;

  // Channel context menu
  contextMenu: { x: number; y: number; channel: Channel } | null;
  setContextMenu: (v: null) => void;
  effectiveNotifyMode: (hubId: string, channelId: string) => NotifyMode;
  setChannelMode: (hubId: string, channelId: string, mode: NotifyMode) => void;

  // First-run wizard
  showHubSetupWizard: boolean;
  closeHubSetupWizard: (hubId: string) => void;
  handleHubSetupWizardComplete: (firstChannelId: string | null) => void | Promise<void>;

  // Channel palette
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  onSelectChannel: (channel: Channel) => void;

  // User context menu
  userContextMenu: { x: number; y: number; user: User } | null;
  setUserContextMenu: (v: null) => void;
  blockedUsers: Set<string>;
  ignoredUsers: Set<string>;
  refreshMembers: () => void | Promise<void>;
  handleUserDm: (u: User) => void | Promise<void>;
  handleUserAddFriend: (u: User) => void | Promise<void>;
  toggleBlockUser: (pubkey: string) => void;
  toggleIgnoreUser: (pubkey: string) => void;
  handleDiscoverJoin: (url: string, code: string) => void;

  // Image lightbox
  lightbox: { src: string; alt: string } | null;
  setLightbox: (v: null) => void;

  // DM encryption warning
  encryptionWarning: EncryptionWarning | null;

  // Keyboard shortcuts
  showKeyboardShortcuts: boolean;
  setShowKeyboardShortcuts: (v: boolean) => void;
}

export function AppModals(p: AppModalsProps) {
  const {
    addHub,
    channelCrud,
    voice,
    hubs,
    activeHubId,
    channels,
    users,
    publicKey,
    isAdmin,
    myRoles,
    error,
    setToast,
    setShowHubBrowser,
    pendingSurveyHubId,
    setPendingSurveyHubId,
    setMyApprovalStatus,
    showQuickInvite,
    setShowQuickInvite,
    showFriends,
    setShowFriends,
    startDmWithAndClose,
    eventComposerChannelId,
    setEventComposerChannelId,
    pollComposerChannelId,
    setPollComposerChannelId,
    createEventForComposer,
    createPollForComposer,
    contextMenu,
    setContextMenu,
    effectiveNotifyMode,
    setChannelMode,
    showHubSetupWizard,
    closeHubSetupWizard,
    handleHubSetupWizardComplete,
    paletteOpen,
    setPaletteOpen,
    onSelectChannel,
    userContextMenu,
    setUserContextMenu,
    blockedUsers,
    ignoredUsers,
    refreshMembers,
    handleUserDm,
    handleUserAddFriend,
    toggleBlockUser,
    toggleIgnoreUser,
    handleDiscoverJoin,
    lightbox,
    setLightbox,
    encryptionWarning,
    showKeyboardShortcuts,
    setShowKeyboardShortcuts,
  } = p;
  const { t } = useTranslation();
  const myMaxPriority = myRoles.reduce((m, r) => Math.max(m, r.priority), 0);
  const canManageRoles = isAdmin || myRoles.some((r) => r.permissions?.includes("manage_roles"));

  return (
    <>
      {addHub.botChallenge && (
        <BotChallenge
          hubUrl={addHub.botChallenge.hubUrl}
          pubkey={addHub.botChallenge.pubkey}
          onPassed={(token) => {
            addHub.setBotChallenge(null);
            addHub.handleAddHub(token);
          }}
          onCancel={() => {
            addHub.setBotChallenge(null);
            addHub.setLoading(false);
          }}
        />
      )}

      {pendingSurveyHubId && (() => {
        const surveyHub = hubs.find((h) => h.hub_id === pendingSurveyHubId);
        if (!surveyHub) return null;
        return (
          <SurveyComponent
            hubUrl={surveyHub.hub_url}
            onComplete={(result: SurveySubmitResult) => {
              setPendingSurveyHubId(null);
              if (result.next_state === "pending") {
                setMyApprovalStatus("pending");
              }
            }}
          />
        );
      })()}

      {addHub.showAddHub && (
        <AddHubModal
          hubUrl={addHub.hubUrl}
          onHubUrlChange={addHub.handleHubUrlChange}
          hubPreview={addHub.hubPreview}
          loading={addHub.loading}
          error={error}
          onAdd={() => addHub.handleAddHub()}
          onClose={() => { addHub.setShowAddHub(false); addHub.setHubUrl(""); addHub.setInviteCode(""); }}
          onBrowse={DISCOVERY_URL ? () => { addHub.setShowAddHub(false); setShowHubBrowser(true); } : undefined}
        />
      )}

      {showQuickInvite && activeHubId && (
        <QuickInviteModal
          activeHubUrl={hubs.find((h) => h.hub_id === activeHubId)?.hub_url ?? ""}
          myMaxPriority={myMaxPriority}
          onClose={() => setShowQuickInvite(false)}
          actions={{
            listRoles: () => invoke<RoleInfo[]>("list_roles"),
            createInvite: (maxUses, expiresInSeconds, grantRoleId) =>
              invoke<InviteInfo>("create_invite", { maxUses, expiresInSeconds, grantRoleId }),
          }}
        />
      )}

      {showFriends && (
        <FriendsModal
          actions={{
            listFriends: () => invoke<Friend[]>("list_friends"),
            listPendingFriendRequests: () => invoke<Friend[]>("list_pending_friends"),
            sendFriendRequest: (targetPublicKey, hubUrl) =>
              invoke("send_friend_request", { targetPublicKey, friendHubUrl: hubUrl ?? null, displayName: null }),
            acceptFriendRequest: (fromPublicKey) => invoke("accept_friend", { fromPublicKey }),
            removeFriend: (targetPublicKey) => invoke("remove_friend", { targetPublicKey }),
          }}
          onMessage={startDmWithAndClose}
          onClose={() => setShowFriends(false)}
        />
      )}

      {eventComposerChannelId && (
        <EventComposer
          channelId={eventComposerChannelId}
          channels={channels}
          canHubWide={isAdmin}
          advancedFieldsSupported
          onSubmit={createEventForComposer}
          onCreated={() => {}}
          onClose={() => setEventComposerChannelId(null)}
        />
      )}

      {pollComposerChannelId && (
        <PollComposer
          channelId={pollComposerChannelId}
          onCreatePoll={createPollForComposer}
          onCreated={() => {}}
          onClose={() => setPollComposerChannelId(null)}
        />
      )}

      {contextMenu && (
        <ChannelContextMenu
          menu={contextMenu}
          activeHubId={activeHubId}
          effectiveNotifyMode={effectiveNotifyMode}
          onSetNotifyMode={setChannelMode}
          onClose={() => setContextMenu(null)}
          onCopyLink={async (channel) => {
            const hubUrl = hubs.find((h) => h.hub_id === activeHubId)?.hub_url;
            if (!hubUrl) return;
            const link = `wavvon://${hubUrl.replace(/^https?:\/\//, "")}/channel/${channel.id}`;
            try {
              await navigator.clipboard.writeText(link);
              setToast(t("message.action.link_copied"));
            } catch (e) {
              setToast(String(e));
            }
          }}
          onCreateEvent={isAdmin ? (channel) => setEventComposerChannelId(channel.id) : undefined}
          onCreatePoll={
            isAdmin || myRoles.some((r) => r.permissions?.includes("send_messages"))
              ? (channel) => setPollComposerChannelId(channel.id)
              : undefined
          }
          onRenameTempRoom={
            contextMenu.channel.is_temporary && contextMenu.channel.owner_pubkey === publicKey && !isAdmin
              ? channelCrud.handleRenameChannel
              : undefined
          }
          onEditBanner={channelCrud.setBannerEditChannel}
          onCreateChannelIn={(parentId) => channelCrud.openCreateChannelUnder(parentId)}
          onCreateChannel={isAdmin ? () => channelCrud.openCreateChannelUnder(null) : undefined}
          onCreateCategory={isAdmin ? () => channelCrud.openCreateChannelUnder(null, true) : undefined}
          onEditChannel={channelCrud.setChannelSettingsModal}
          onDeleteChannel={(channel) => channelCrud.handleDeleteChannel(channel.id)}
        />
      )}

      {channelCrud.editDescriptionChannel && (
        <EditDescriptionModal
          channel={channelCrud.editDescriptionChannel}
          description={channelCrud.editDescriptionValue}
          onDescriptionChange={channelCrud.setEditDescriptionValue}
          onSave={channelCrud.handleSaveDescription}
          onClose={() => channelCrud.setEditDescriptionChannel(null)}
        />
      )}

      {channelCrud.bannerEditChannel && (
        <BannerEditModal
          channel={channelCrud.bannerEditChannel}
          onSave={channelCrud.handleSaveBannerUrl}
          onClose={() => channelCrud.setBannerEditChannel(null)}
        />
      )}

      {lightbox && (
        <Lightbox
          src={lightbox.src}
          alt={lightbox.alt}
          onClose={() => setLightbox(null)}
        />
      )}

      {(channelCrud.showCreateChannel || channelCrud.channelSettingsModal) && (
        <ChannelSettingsModal
          channel={channelCrud.channelSettingsModal}
          createParentId={channelCrud.newChannelParentId}
          createParentName={channelCrud.newChannelParentId ? (channels.find((c) => c.id === channelCrud.newChannelParentId)?.name ?? null) : null}
          createInitialIsCategory={channelCrud.createIsCategory}
          saving={channelCrud.channelSettingsModal ? channelCrud.channelSettingsSaving : channelCrud.createChannelLoading}
          deleting={channelCrud.channelSettingsDeleting}
          error={channelCrud.channelSettingsModal ? channelCrud.channelSettingsError : channelCrud.createChannelError}
          canManageRoles={canManageRoles}
          isAdmin={isAdmin}
          myMaxPriority={myMaxPriority}
          hubUrl={hubs.find((h) => h.hub_id === activeHubId)?.hub_url}
          onSave={channelCrud.channelSettingsModal ? channelCrud.handleSaveChannelSettings : channelCrud.handleCreateChannel}
          onDelete={channelCrud.handleDeleteChannelSettings}
          onClose={() => {
            channelCrud.setShowCreateChannel(false); channelCrud.setCreateChannelError(null);
            channelCrud.setChannelSettingsModal(null); channelCrud.setChannelSettingsError(null);
          }}
          permissionsActions={channelCrud.channelPermissionsTabActions}
          bansActions={channelCrud.channelBansTabActions}
          bansUsers={users}
          bansSupportReason
          talkPowerActions={channelCrud.channelTalkPowerTabActions}
          listHubIcons={() => invoke<HubIcon[]>("list_hub_icons")}
          bannerUploadSupported={true}
          listForumTags={(channelId) => invoke<ForumTagDef[]>("forum_list_tags", { channelId })}
          forumTagsActions={{
            createTag: (channelId, label, color, position) =>
              invoke<ForumTagDef>("forum_create_tag", { channelId, label, color: color ?? null, position: position ?? null }),
            editTag: (tagId, updates) =>
              invoke<ForumTagDef>("forum_edit_tag", {
                tagId,
                label: updates.label ?? null,
                color: updates.color ?? null,
                position: updates.position ?? null,
              }),
            deleteTag: (tagId) => invoke<void>("forum_delete_tag", { tagId }),
          }}
        />
      )}

      {showHubSetupWizard && activeHubId && (
        <HubSetupWizard
          actions={{ onCreateChannel: channelCrud.createChannelForWizard }}
          onDismiss={() => closeHubSetupWizard(activeHubId)}
          onComplete={handleHubSetupWizardComplete}
        />
      )}

      {paletteOpen && (
        <ChannelPalette
          channels={channels.filter((c) => !c.is_category)}
          onClose={() => setPaletteOpen(false)}
          onSelect={(c) => { setPaletteOpen(false); onSelectChannel(c); }}
        />
      )}

      {userContextMenu && (
        <UserContextMenu
          user={userContextMenu.user}
          publicKey={publicKey}
          isAdmin={isAdmin}
          canManageRoles={canManageRoles}
          myMaxPriority={myMaxPriority}
          blockedUsers={blockedUsers}
          ignoredUsers={ignoredUsers}
          position={{ x: userContextMenu.x, y: userContextMenu.y }}
          onClose={() => setUserContextMenu(null)}
          onToast={setToast}
          onRolesChanged={() => { void refreshMembers(); }}
          actions={{
            listRoles: () => invoke<RoleInfo[]>("list_roles"),
            listUserRoles: async (pubkey) => {
              const [all, members] = await Promise.all([
                invoke<RoleInfo[]>("list_roles"),
                invoke<MemberAdminInfo[]>("list_hub_members"),
              ]);
              const ids = new Set(members.find((m) => m.public_key === pubkey)?.roles.map((r) => r.id) ?? []);
              return all.filter((r) => ids.has(r.id));
            },
            assignRole: (pubkey, roleId) => invoke("assign_role", { targetPublicKey: pubkey, roleId }),
            removeRole: (pubkey, roleId) => invoke("unassign_role", { targetPublicKey: pubkey, roleId }),
            muteUser: (pubkey) => invoke("mute_user_cmd", { targetPublicKey: pubkey, reason: null }),
            kickUser: (pubkey) => invoke("kick_user_cmd", { targetPublicKey: pubkey, reason: null }),
            banUser: (pubkey) => invoke("ban_user_cmd", { targetPublicKey: pubkey, reason: null }),
            dm: handleUserDm,
            addFriend: handleUserAddFriend,
            toggleBlock: toggleBlockUser,
            toggleIgnore: toggleIgnoreUser,
            fetchPublicProfile: (pubkey) => invoke<PublicHubProfile | null>("fetch_public_profile", {
              hubUrl: hubs.find((h) => h.hub_id === activeHubId)?.hub_url ?? "",
              pubkey,
            }),
            joinHub: handleDiscoverJoin,
          }}
        />
      )}

      <ScreenShareOverlay
        ref={voice.screenShareViewerRef}
        streams={[...voice.activeScreenShares, ...voice.crossChannelStreams]}
        mediaOutputDeviceId={voice.mediaOutputDeviceId || undefined}
      />

      {voice.showSharePicker && (
        <ScreenShareModal
          onStart={voice.handleShareStart}
          onCancel={() => voice.setShowSharePicker(false)}
        />
      )}

      {encryptionWarning && <EncryptionWarningModal {...encryptionWarning} />}

      {showKeyboardShortcuts && (
        <KeyboardShortcuts onClose={() => setShowKeyboardShortcuts(false)} />
      )}
    </>
  );
}
