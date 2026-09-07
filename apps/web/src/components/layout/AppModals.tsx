import { useTranslation } from "react-i18next";
import {
  AddHubModal,
  ChannelContextMenu,
  ChannelSettingsModal,
  DisplayNamePrompt,
  EditDescriptionModal,
  EventComposer,
  FocusTrap,
  HubSetupWizard,
  PollComposer,
  QuickInviteModal,
  RemoveHubModal,
  EncryptionWarningModal,
} from "@wavvon/ui";
import {
  createEvent,
  createInvite,
  createPoll,
  forumCreateTag,
  forumDeleteTag,
  forumEditTag,
  forumListTags,
  listHubIcons,
  listRoles,
} from "@platform";
import { passkeysUsableWith } from "@platform";
import { DISCOVERY_URL, MULTI_HUB } from "../../constants";
import { HubAdminContainer } from "../admin/HubAdminContainer";
import type { AppModalsProps } from "./appModalsProps";
import { IdentityBackupPrompt } from "@components/identity/IdentityBackupPrompt";

// Every modal and context menu the app can put over itself.
//
// They used to live at the bottom of App.tsx, ~215 lines of
// `{showX && <XModal/>}` between the layout and the closing tag — which is
// how App.tsx grew while the refactor that was supposed to shrink it stalled.
// Nothing here holds state: each block reads a flag and a handful of handlers,
// which is exactly what makes them movable.
//
// The props are named after the values they carry, so the JSX below is the
// original text unchanged — a move, not a rewrite, and reviewable as one.
export function AppModals(p: AppModalsProps) {
  const { removeHub, onOpenHomeHubSettings } = p;
  const {
    activeHubId,
    addHubError,
    addingHub,
    canManageRoles,
    canManageSoundboard,
    canSendMessages,
    channelBansTabActions,
    channelCtxMenu,
    channelPermissionsTabActions,
    channelSettingsCtx,
    channelSettingsDeleting,
    channelSettingsError,
    channelSettingsSaving,
    channelTalkPowerTabActions,
    channels,
    closeHubSetupWizard,
    createChannelCtx,
    createChannelError,
    createChannelForWizard,
    createChannelLoading,
    editDescChannel,
    editDescValue,
    effectiveNotifyMode,
    eventComposerChannelId,
    fingerprintMatch,
    handleAddHub,
    handleAddHubWithPasskey,
    handleCreateChannel,
    handleDeleteChannel,
    handleHubSetupWizardComplete,
    handleHubUrlInput,
    handleRenameRoom,
    handleSaveChannelSettings,
    handleSaveDescription,
    handleSaveFirstRunName,
    hubAdminState,
    hubPreview,
    hubUrl,
    hubs,
    inviteCode,
    isAdmin,
    myMaxPriority,
    pollComposerChannelId,
    publicKey,
    renameRoomCtx,
    renameRoomError,
    renameRoomName,
    renameRoomSaving,
    setAddHubError,
    setChannelCtxMenu,
    setChannelNotifyMode,
    setChannelSettingsCtx,
    setChannelSettingsError,
    setCreateChannelCtx,
    setCreateChannelError,
    setEditDescChannel,
    setEditDescValue,
    setEventComposerChannelId,
    setFingerprintMatch,
    setHubPreview,
    setInviteCode,
    setPollComposerChannelId,
    setRenameRoomCtx,
    setRenameRoomError,
    setRenameRoomName,
    setShowAddHub,
    setShowDiscover,
    setShowDisplayNamePrompt,
    setShowHubAdmin,
    setShowQuickInvite,
    showAddHub,
    showDisplayNamePrompt,
    showHubAdmin,
    showHubError,
    showHubSetupWizard,
    showBackupPrompt,
    onBackupPromptShowPhrase,
    onBackupPromptLater,
    showQuickInvite,
    users,
  } = p;
  const { t } = useTranslation();

  return (
    <>
      {showHubAdmin && activeHubId && (
        <HubAdminContainer
          hubAdmin={hubAdminState}
          channels={channels}
          hubs={hubs}
          activeHubId={activeHubId}
          publicKey={publicKey}
          isAdmin={isAdmin}
          canManageRoles={canManageRoles}
          canManageSoundboard={canManageSoundboard}
          myMaxPriority={myMaxPriority}
          onClose={() => setShowHubAdmin(false)}
        />
      )}

      {MULTI_HUB && showAddHub && (
        <AddHubModal
          hubUrl={hubUrl}
          onHubUrlChange={handleHubUrlInput}
          hubPreview={hubPreview}
          inviteCode={inviteCode}
          onInviteCodeChange={setInviteCode}
          loading={addingHub}
          error={addHubError}
          fingerprintMatch={fingerprintMatch}
          onAdd={handleAddHub}
          onAddWithPasskey={publicKey ? handleAddHubWithPasskey : undefined}
          passkeySupported={passkeysUsableWith(hubUrl)}
          onClose={() => {
            setShowAddHub(false);
            setHubPreview({ state: "idle" });
            setAddHubError(null);
            setFingerprintMatch(false);
          }}
          onBrowse={DISCOVERY_URL ? () => { setShowAddHub(false); setShowDiscover(true); } : undefined}
        />
      )}

      {showBackupPrompt && (
        <IdentityBackupPrompt
          onShowPhrase={onBackupPromptShowPhrase}
          onLater={onBackupPromptLater}
        />
      )}

      {showQuickInvite && activeHubId && (
        <QuickInviteModal
          activeHubUrl={hubs.find((h) => h.hub_id === activeHubId)?.hub_url ?? ""}
          myMaxPriority={myMaxPriority}
          onClose={() => setShowQuickInvite(false)}
          actions={{ listRoles, createInvite }}
        />
      )}

      {eventComposerChannelId && (
        <EventComposer
          channelId={eventComposerChannelId}
          channels={channels}
          canHubWide={isAdmin}
          advancedFieldsSupported
          onSubmit={createEvent}
          onCreated={() => {}}
          onClose={() => setEventComposerChannelId(null)}
        />
      )}

      {pollComposerChannelId && (
        <PollComposer
          channelId={pollComposerChannelId}
          onCreatePoll={createPoll}
          onCreated={() => {}}
          onClose={() => setPollComposerChannelId(null)}
        />
      )}

      {(createChannelCtx || channelSettingsCtx) && (
        <ChannelSettingsModal
          channel={channelSettingsCtx}
          createParentId={createChannelCtx?.parentId ?? null}
          createParentName={createChannelCtx?.parentId ? (channels.find((c) => c.id === createChannelCtx.parentId)?.name ?? null) : null}
          createInitialIsCategory={createChannelCtx?.isCategory}
          saving={channelSettingsCtx ? channelSettingsSaving : createChannelLoading}
          deleting={channelSettingsDeleting}
          error={channelSettingsCtx ? channelSettingsError : createChannelError}
          canManageRoles={canManageRoles}
          isAdmin={isAdmin}
          myMaxPriority={myMaxPriority}
          hubUrl={hubs.find((h) => h.hub_id === activeHubId)?.hub_url}
          onSave={channelSettingsCtx ? handleSaveChannelSettings : handleCreateChannel}
          onDelete={handleDeleteChannel}
          onClose={() => {
            setCreateChannelCtx(null); setCreateChannelError(null);
            setChannelSettingsCtx(null); setChannelSettingsError(null);
          }}
          permissionsActions={channelPermissionsTabActions}
          bansActions={channelBansTabActions}
          bansUsers={users}
          talkPowerActions={channelTalkPowerTabActions}
          listHubIcons={listHubIcons}
          listForumTags={forumListTags}
          forumTagsActions={{ createTag: forumCreateTag, editTag: forumEditTag, deleteTag: forumDeleteTag }}
        />
      )}

      {showHubSetupWizard && activeHubId && (
        <HubSetupWizard
          actions={{ onCreateChannel: createChannelForWizard }}
          onDismiss={() => closeHubSetupWizard(activeHubId)}
          onComplete={handleHubSetupWizardComplete}
        />
      )}

      {channelCtxMenu && (
        <ChannelContextMenu
          menu={channelCtxMenu}
          activeHubId={activeHubId}
          effectiveNotifyMode={effectiveNotifyMode}
          onSetNotifyMode={(hubId, channelId, mode) => {
            setChannelNotifyMode((prev) => {
              const hubMap = { ...(prev[hubId] ?? {}) };
              if (mode === "all") delete hubMap[channelId]; else hubMap[channelId] = mode;
              return { ...prev, [hubId]: hubMap };
            });
          }}
          onClose={() => setChannelCtxMenu(null)}
          onCopyLink={async (channel) => {
            const hubUrl = hubs.find((h) => h.hub_id === activeHubId)?.hub_url;
            if (!hubUrl) return;
            const link = `wavvon://${hubUrl.replace(/^https?:\/\//, "")}/channel/${channel.id}`;
            try {
              await navigator.clipboard.writeText(link);
              showHubError(t("message.action.link_copied"));
            } catch (e) {
              showHubError(String(e));
            }
          }}
          onCreateEvent={isAdmin ? (channel) => setEventComposerChannelId(channel.id) : undefined}
          onCreatePoll={canSendMessages ? (channel) => setPollComposerChannelId(channel.id) : undefined}
          onRenameTempRoom={
            channelCtxMenu.channel.is_temporary && channelCtxMenu.channel.owner_pubkey === publicKey && !isAdmin
              ? (channel) => {
                  setRenameRoomCtx(channel);
                  setRenameRoomName(channel.name);
                  setRenameRoomError(null);
                }
              : undefined
          }
          onCreateChannelIn={isAdmin ? (parentId) => { setChannelSettingsCtx(null); setCreateChannelCtx({ parentId, isCategory: false }); setCreateChannelError(null); } : undefined}
          onCreateChannel={isAdmin ? () => { setChannelSettingsCtx(null); setCreateChannelCtx({ parentId: null, isCategory: false }); setCreateChannelError(null); } : undefined}
          onCreateCategory={isAdmin ? () => { setChannelSettingsCtx(null); setCreateChannelCtx({ parentId: null, isCategory: true }); setCreateChannelError(null); } : undefined}
          onEditChannel={isAdmin ? (channel) => { setCreateChannelCtx(null); setChannelSettingsCtx(channel); setChannelSettingsError(null); } : undefined}
          onDeleteChannel={isAdmin ? (channel) => { setCreateChannelCtx(null); setChannelSettingsCtx(channel); setChannelSettingsError(null); } : undefined}
        />
      )}

      {editDescChannel && (
        <EditDescriptionModal
          channel={editDescChannel}
          description={editDescValue}
          onDescriptionChange={setEditDescValue}
          onSave={() => void handleSaveDescription()}
          onClose={() => setEditDescChannel(null)}
        />
      )}

      {renameRoomCtx && (
        <div className="modal-overlay" onClick={() => setRenameRoomCtx(null)}>
          <FocusTrap>
            <div className="modal" style={{ maxWidth: 400 }} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <h3>{t("channel.temp.rename_title")}</h3>
              <input
                type="text"
                value={renameRoomName}
                onChange={(e) => setRenameRoomName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleRenameRoom();
                  if (e.key === "Escape") setRenameRoomCtx(null);
                }}
                autoFocus
                style={{ display: "block", width: "100%", marginBottom: "var(--space-3)" }}
              />
              {renameRoomError && <div className="error" style={{ marginBottom: 8 }}>{renameRoomError}</div>}
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setRenameRoomCtx(null)}>{t("modal.cancel")}</button>
                <button onClick={() => void handleRenameRoom()} disabled={renameRoomSaving || !renameRoomName.trim()}>
                  {renameRoomSaving ? "…" : t("modal.save")}
                </button>
              </div>
            </div>
          </FocusTrap>
        </div>
      )}

      {showDisplayNamePrompt && (
        <DisplayNamePrompt
          onSave={handleSaveFirstRunName}
          onSkip={() => setShowDisplayNamePrompt(false)}
        />
      )}

      {p.encryptionWarning && <EncryptionWarningModal {...p.encryptionWarning} />}

      {removeHub.pending && (
        <RemoveHubModal
          hubName={removeHub.pending.hubName}
          homeHub={removeHub.homeHub}
          hubFarewell={removeHub.farewell}
          onLeaveHub={removeHub.canLeave ? () => void removeHub.leave() : undefined}
          leaveNeedsInvite={removeHub.leaveNeedsInvite}
          onOpenHomeHubSettings={onOpenHomeHubSettings}
          onConfirm={() => void removeHub.confirm()}
          onCancel={removeHub.cancel}
        />
      )}
    </>
  );
}
