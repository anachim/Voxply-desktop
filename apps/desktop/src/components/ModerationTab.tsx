import { useTranslation } from "react-i18next";
import {
  ContentReportsSection,
  AutomodWebhookSection,
  FederatedBanlistSection,
} from "@wavvon/ui";
import { contentReportActions, automodActions, banlistActions } from "../hooks/hubAdminActions";

/** Desktop's moderation tab. Web has had one since the moderation suite
 *  shipped; desktop had no surface for any of it, so a moderator here could
 *  not see what members had flagged.
 *
 *  Reports, the automod webhook and federated ban lists so far — the
 *  outgoing-webhook manager is the last section still web-only. */
export function ModerationTab() {
  const { t } = useTranslation();
  return (
    <section>
      <h1>{t("channel.settings.tab_moderation")}</h1>
      <ContentReportsSection actions={contentReportActions} />
      <AutomodWebhookSection actions={automodActions} />
      <FederatedBanlistSection actions={banlistActions} />
    </section>
  );
}
