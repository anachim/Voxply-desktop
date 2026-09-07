import { useTranslation } from "react-i18next";
import { ContentReportsSection } from "@wavvon/ui";
import { contentReportActions } from "../hooks/hubAdminActions";

/** Desktop's moderation tab. Web has had one since the moderation suite
 *  shipped; desktop had no surface for any of it, so a moderator here could
 *  not see what members had flagged.
 *
 *  Reports first — the rest of web's tab (automod webhook, federated ban
 *  lists) follows section by section rather than in one drop, since each
 *  needs its own Tauri commands. */
export function ModerationTab() {
  const { t } = useTranslation();
  return (
    <section>
      <h1>{t("channel.settings.tab_moderation")}</h1>
      <ContentReportsSection actions={contentReportActions} />
    </section>
  );
}
