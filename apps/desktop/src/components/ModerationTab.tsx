import { useTranslation } from "react-i18next";
import { ContentReportsSection, AutomodWebhookSection } from "@wavvon/ui";
import { contentReportActions, automodActions } from "../hooks/hubAdminActions";

/** Desktop's moderation tab. Web has had one since the moderation suite
 *  shipped; desktop had no surface for any of it, so a moderator here could
 *  not see what members had flagged.
 *
 *  Reports and the automod webhook so far — federated ban lists and the
 *  outgoing-webhook manager follow, each with its own Tauri commands. */
export function ModerationTab() {
  const { t } = useTranslation();
  return (
    <section>
      <h1>{t("channel.settings.tab_moderation")}</h1>
      <ContentReportsSection actions={contentReportActions} />
      <AutomodWebhookSection actions={automodActions} />
    </section>
  );
}
