import { ContentReportsSection } from "@wavvon/ui";
import { listReports, reviewReport } from "../../platform/commands/moderation";
import { useTranslation } from "react-i18next";
import { AutomodWebhookSection } from "./AutomodWebhookSection";
import { FederatedBanlistSection } from "./FederatedBanlistSection";

// Stable identity: the section loads on mount and must not reload because a
// parent re-rendered.
const contentReportActions = { listReports, reviewReport };

export function ModerationTab() {
  const { t } = useTranslation();
  return (
    <section>
      <h1>{t("channel.settings.tab_moderation")}</h1>
      <ContentReportsSection actions={contentReportActions} />
      <AutomodWebhookSection />
      <FederatedBanlistSection />
    </section>
  );
}
