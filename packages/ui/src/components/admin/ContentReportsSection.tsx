import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatRelative } from "@wavvon/core";
import type { Report, ReportAction } from "../../types";

export interface ContentReportsActions {
  /** `GET /admin/reports?status=` — pending is what a moderator opens this for. */
  listReports: (status: string) => Promise<Report[]>;
  reviewReport: (reportId: string, action: ReportAction) => Promise<void>;
}

function truncate(s: string | null, max: number): string {
  if (!s) return "—";
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/** The pending report queue: what members flagged, and the three things a
 *  moderator can do about each. Hoisted from web 2026-09-08 so desktop can
 *  have it too — the reason this is prop-only is that the two clients reach
 *  the same hub endpoints through different transports. */
export function ContentReportsSection({ actions }: { actions: ContentReportsActions }) {
  const { t } = useTranslation();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setReports(await actions.listReports("pending"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Actions are a stable object from the app's own wiring; re-running on it
    // would reload the queue on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleReview(reportId: string, action: ReportAction) {
    try {
      await actions.reviewReport(reportId, action);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="settings-section">
      <h2>{t("hub.admin.reports.title")}</h2>
      {error && <p className="error-text">{error}</p>}
      {loading && <p className="muted">{t("hub.admin.reports.loading")}</p>}
      {!loading && reports.length === 0 && (
        <p className="muted">{t("hub.admin.reports.empty")}</p>
      )}
      {!loading && reports.length > 0 && (
        <table className="members-table">
          <thead>
            <tr>
              <th>{t("hub.admin.reports.col.preview")}</th>
              <th>{t("hub.admin.reports.col.reporter")}</th>
              <th>{t("hub.admin.reports.col.reason")}</th>
              <th>{t("hub.admin.reports.col.reported")}</th>
              <th>{t("hub.admin.reports.col.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.id}>
                <td>
                  <span className="muted" style={{ fontSize: "var(--text-xs)" }}>
                    {truncate(r.message_content, 100)}
                  </span>
                </td>
                <td>
                  <span className="member-pk">{r.reporter_pubkey.slice(0, 8)}</span>
                </td>
                <td>{r.reason}</td>
                <td>{formatRelative(r.reported_at)}</td>
                <td style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                  <button
                    className="btn-small btn-secondary"
                    onClick={() => handleReview(r.id, "dismiss")}
                  >
                    {t("hub.admin.reports.dismiss")}
                  </button>
                  <button
                    className="btn-small btn-secondary danger"
                    onClick={() => handleReview(r.id, "delete_message")}
                  >
                    {t("hub.admin.reports.delete_message")}
                  </button>
                  <button
                    className="btn-small btn-secondary danger"
                    onClick={() => handleReview(r.id, "ban_user")}
                  >
                    {t("hub.admin.reports.ban_user")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
