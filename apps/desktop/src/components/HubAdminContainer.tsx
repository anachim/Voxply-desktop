import { useMemo } from "react";
import { HubAdminPage, type HubAdminPageProps } from "@wavvon/ui";
import { ModerationTab } from "./ModerationTab";
import type { Hub, RoleInfo } from "../types";
import {
  rolesActions,
  memberRoleActions,
  serverTagsActions,
  inviteActions,
  allianceActions,
  hubIconActions,
  submitToDirectory,
  makeWebhookActions,
  makeExternalBotActions,
  makeAuditLogActions,
  makeCertActions,
  makeOnboardingActions,
  makeSurveyActions,
} from "../hooks/hubAdminActions";

type PassthroughProps = Omit<
  HubAdminPageProps,
  | "saveError"
  | "rolesActions" | "memberRoleActions" | "serverTagsActions" | "inviteActions"
  | "allianceActions" | "hubIconActions" | "submitToDirectory"
  | "webhookActions" | "externalBotActions"
  | "auditLogActions" | "certActions" | "onboardingActions" | "surveyActions"
  | "activeHubUrl" | "myPubkey"
  | "canManageRoles" | "myMaxPriority" | "canManageSoundboard"
>;

interface HubAdminContainerProps extends PassthroughProps {
  hubs: Hub[];
  activeHubId: string | null;
  myRoles: RoleInfo[];
  publicKey: string | null;
}

// App-local wrapper around the shared HubAdminPage. That component's prop
// surface is ~40 wide because it's one big admin shell over a dozen
// independently-actioned sections. The sections whose actions never touch
// the active hub's URL live as module-level consts in hooks/hubAdminActions
// (nothing to rebuild per render); the ones that do need "whichever hub is
// active right now" are built here from hubs/activeHubId, which is App state.
export function HubAdminContainer({
  hubs,
  activeHubId,
  myRoles,
  publicKey,
  isAdmin,
  ...rest
}: HubAdminContainerProps) {
  const activeHubUrl = hubs.find((h) => h.hub_id === activeHubId)?.hub_url ?? "";
  const getActiveHubUrl = () => activeHubUrl;

  const webhookActions = useMemo(() => makeWebhookActions(getActiveHubUrl), [activeHubUrl]);
  const externalBotActions = useMemo(() => makeExternalBotActions(getActiveHubUrl), [activeHubUrl]);
  const auditLogActions = useMemo(() => makeAuditLogActions(getActiveHubUrl), [activeHubUrl]);
  const certActions = useMemo(() => makeCertActions(getActiveHubUrl), [activeHubUrl]);
  const onboardingActions = useMemo(() => makeOnboardingActions(getActiveHubUrl), [activeHubUrl]);
  const surveyActions = useMemo(() => makeSurveyActions(getActiveHubUrl), [activeHubUrl]);

  const canManageRoles = isAdmin || myRoles.some((r) => r.permissions?.includes("manage_roles"));
  const myMaxPriority = myRoles.reduce((m, r) => Math.max(m, r.priority), 0);
  const canManageSoundboard = isAdmin || myRoles.some((r) => r.permissions?.includes("manage_soundboard"));

  return (
    <HubAdminPage
      {...rest}
      isAdmin={isAdmin}
      renderModerationTab={() => <ModerationTab />}
      saveError={null}
      activeHubUrl={activeHubUrl}
      myPubkey={publicKey ?? ""}
      canManageRoles={canManageRoles}
      myMaxPriority={myMaxPriority}
      canManageSoundboard={canManageSoundboard}
      rolesActions={rolesActions}
      memberRoleActions={memberRoleActions}
      serverTagsActions={serverTagsActions}
      inviteActions={inviteActions}
      allianceActions={allianceActions}
      hubIconActions={hubIconActions}
      submitToDirectory={submitToDirectory}
      webhookActions={webhookActions}
      externalBotActions={externalBotActions}
      auditLogActions={auditLogActions}
      certActions={certActions}
      onboardingActions={onboardingActions}
      surveyActions={surveyActions}
    />
  );
}
