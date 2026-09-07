import type { EncryptionWarning } from "@wavvon/ui";
import type React from "react";
import type { Channel, Hub, User } from "@shared/types";
import type { NotifyMode } from "@wavvon/ui";
import type { useChannelCrud } from "../../hooks/useChannelCrud";
import type { useHubAdmin } from "../../hooks/useHubAdmin";
import type { useAddHubFlow } from "../../hooks/useAddHubFlow";
import type { useNotificationPrefs } from "../../hooks/useNotificationPrefs";
import type { HubAdminContainerProps } from "../admin/HubAdminContainer";

// The props `AppModals` needs, kept beside it rather than inside it: the list
// is long because the modals it holds are the app's, and pretending otherwise
// would mean giving the component its own state — which is the thing that
// makes a render tree hard to move in the first place.
//
// Types are borrowed from the hooks that own each value, so a change in
// `useChannelCrud` (or the add-hub flow, or hub admin) shows up here as a type
// error rather than as a modal that quietly stops opening.

type ChannelCrud = ReturnType<typeof useChannelCrud>;
type AddHubFlow = ReturnType<typeof useAddHubFlow>;
type HubAdmin = ReturnType<typeof useHubAdmin>;
type NotifyPrefs = ReturnType<typeof useNotificationPrefs>;

import type { useRemoveHubConfirm } from "../../hooks/useRemoveHubConfirm";

export interface AppModalsProps {
  // Remove-a-hub confirmation. The dialog only reports; the decision of what
  // it may say lives in the hook (decisions.md, "Leave hub does not leave").
  removeHub: ReturnType<typeof useRemoveHubConfirm>;
  /** A DM waiting on the user to say whether it may leave unencrypted. */
  encryptionWarning: EncryptionWarning | null;
  onOpenHomeHubSettings: () => void;

  // Hub admin
  showHubAdmin: boolean;
  setShowHubAdmin: (v: boolean) => void;
  hubAdminState: HubAdmin;
  canManageSoundboard: boolean;

  // Add a hub
  showAddHub: boolean;
  setShowAddHub: (v: boolean) => void;
  hubUrl: AddHubFlow["hubUrl"];
  handleHubUrlInput: AddHubFlow["handleHubUrlInput"];
  hubPreview: AddHubFlow["hubPreview"];
  setHubPreview: AddHubFlow["setHubPreview"];
  inviteCode: AddHubFlow["inviteCode"];
  setInviteCode: AddHubFlow["setInviteCode"];
  addingHub: boolean;
  addHubError: string | null;
  setAddHubError: (v: string | null) => void;
  fingerprintMatch: boolean;
  setFingerprintMatch: (v: boolean) => void;
  handleAddHub: () => void | Promise<void>;
  handleAddHubWithPasskey: () => void | Promise<void>;
  setShowDiscover: (v: boolean) => void;

  // Identity backup — one prompt at the first message an unsaved identity
  // sends (utils/identityBackup.ts).
  showBackupPrompt: boolean;
  onBackupPromptShowPhrase: () => void;
  onBackupPromptLater: () => void;

  // Invites
  showQuickInvite: boolean;
  setShowQuickInvite: (v: boolean) => void;

  // Composers
  eventComposerChannelId: string | null;
  setEventComposerChannelId: (v: string | null) => void;
  pollComposerChannelId: string | null;
  setPollComposerChannelId: (v: string | null) => void;

  // Channel create / settings / rename — all owned by useChannelCrud
  createChannelCtx: ChannelCrud["createChannelCtx"];
  setCreateChannelCtx: ChannelCrud["setCreateChannelCtx"];
  createChannelLoading: boolean;
  createChannelError: string | null;
  setCreateChannelError: ChannelCrud["setCreateChannelError"];
  channelSettingsCtx: ChannelCrud["channelSettingsCtx"];
  setChannelSettingsCtx: ChannelCrud["setChannelSettingsCtx"];
  channelSettingsSaving: boolean;
  channelSettingsDeleting: boolean;
  channelSettingsError: string | null;
  setChannelSettingsError: ChannelCrud["setChannelSettingsError"];
  handleCreateChannel: ChannelCrud["handleCreateChannel"];
  handleSaveChannelSettings: ChannelCrud["handleSaveChannelSettings"];
  handleDeleteChannel: ChannelCrud["handleDeleteChannel"];
  createChannelForWizard: ChannelCrud["createChannelForWizard"];
  handleHubSetupWizardComplete: ChannelCrud["handleHubSetupWizardComplete"];
  editDescChannel: ChannelCrud["editDescChannel"];
  setEditDescChannel: ChannelCrud["setEditDescChannel"];
  editDescValue: string;
  setEditDescValue: ChannelCrud["setEditDescValue"];
  handleSaveDescription: ChannelCrud["handleSaveDescription"];
  renameRoomCtx: ChannelCrud["renameRoomCtx"];
  setRenameRoomCtx: ChannelCrud["setRenameRoomCtx"];
  renameRoomName: string;
  setRenameRoomName: ChannelCrud["setRenameRoomName"];
  renameRoomSaving: boolean;
  renameRoomError: string | null;
  handleRenameRoom: ChannelCrud["handleRenameRoom"];
  setRenameRoomError: ChannelCrud["setRenameRoomError"];

  // Channel settings tabs
  channelPermissionsTabActions: HubAdminContainerProps["hubAdmin"] extends never
    ? never
    : React.ComponentProps<typeof import("@wavvon/ui").ChannelSettingsModal>["permissionsActions"];
  channelBansTabActions: React.ComponentProps<
    typeof import("@wavvon/ui").ChannelSettingsModal
  >["bansActions"];
  channelTalkPowerTabActions: React.ComponentProps<
    typeof import("@wavvon/ui").ChannelSettingsModal
  >["talkPowerActions"];

  // First-run wizard and prompt
  showHubSetupWizard: boolean;
  closeHubSetupWizard: (hubId: string) => void;
  showDisplayNamePrompt: boolean;
  setShowDisplayNamePrompt: (v: boolean) => void;
  handleSaveFirstRunName: (name: string) => void | Promise<void>;

  // Channel context menu
  channelCtxMenu: React.ComponentProps<
    typeof import("@wavvon/ui").ChannelContextMenu
  >["menu"] | null;
  setChannelCtxMenu: (v: null) => void;
  effectiveNotifyMode: NotifyPrefs["effectiveNotifyMode"];
  setChannelNotifyMode: NotifyPrefs["setChannelNotifyMode"];

  // Shared context
  activeHubId: string | null;
  hubs: Hub[];
  channels: Channel[];
  users: User[];
  publicKey: string | null;
  isAdmin: boolean;
  canManageRoles: boolean;
  canSendMessages: boolean;
  myMaxPriority: number;
  showHubError: (msg: string) => void;
}
