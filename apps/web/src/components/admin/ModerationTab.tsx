import { ContentReportsSection, AutomodWebhookSection } from "@wavvon/ui";
import {
  listReports,
  reviewReport,
  getModerationSettings,
  patchModerationSettings,
} from "../../platform/commands/moderation";
import { useTranslation } from "react-i18next";
import { FederatedBanlistSection } from "./FederatedBanlistSection";

// Stable identity: the section loads on mount and must not reload because a
// parent re-rendered.
const contentReportActions = { listReports, reviewReport };
const automodActions = { getModerationSettings, patchModerationSettings };

export function ModerationTab() {
  const { t } = useTranslation();
  return (
    <section>
      <h1>{t("channel.settings.tab_moderation")}</h1>
      <ContentReportsSection actions={contentReportActions} />
      <AutomodWebhookSection actions={automodActions} />
      <FederatedBanlistSection />
    </section>
  );
}
