import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BanlistSource, FederatedBanEntry, BanlistOverride } from "../../types";

export interface FederatedBanlistActions {
  getBanlistSettings: () => Promise<{ publish_banlist: boolean; sources: BanlistSource[] }>;
  getBanlistEntries: (source?: string) => Promise<FederatedBanEntry[]>;
  getBanlistOverrides: () => Promise<BanlistOverride[]>;
  addBanlistSource: (url: string, policy: "hard-reject" | "soft-flag") => Promise<void>;
  removeBanlistSource: (url: string) => Promise<void>;
  updateBanlistSourcePolicy: (url: string, policy: "hard-reject" | "soft-flag") => Promise<void>;
  addBanlistOverride: (
    targetPubkey: string,
    overrideType: "whitelist" | "blacklist",
    reason?: string,
  ) => Promise<void>;
  removeBanlistOverride: (targetPubkey: string) => Promise<void>;
  setBanlistPublish: (publish: boolean) => Promise<void>;
}
import { formatRelative } from "@wavvon/core";

export function FederatedBanlistSection({ actions }: { actions: FederatedBanlistActions }) {
  const { t } = useTranslation();
  const [sources, setSources] = useState<BanlistSource[]>([]);
  const [entries, setEntries] = useState<FederatedBanEntry[]>([]);
  const [overrides, setOverrides] = useState<BanlistOverride[]>([]);
  const [publishBanlist, setPublishBanlist] = useState(false);
  const [entriesOpen, setEntriesOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newSourceUrl, setNewSourceUrl] = useState("");
  const [newSourcePolicy, setNewSourcePolicy] = useState<"hard-reject" | "soft-flag">("hard-reject");

  const [newOverridePubkey, setNewOverridePubkey] = useState("");
  const [newOverrideType, setNewOverrideType] = useState<"whitelist" | "blacklist">("whitelist");
  const [newOverrideReason, setNewOverrideReason] = useState("");

  async function load() {
    setError(null);
    try {
      const [settingsData, entriesData, overridesData] = await Promise.all([
        actions.getBanlistSettings(),
        actions.getBanlistEntries(),
        actions.getBanlistOverrides(),
      ]);
      setSources(settingsData.sources);
      setPublishBanlist(settingsData.publish_banlist);
      setEntries(entriesData);
      setOverrides(overridesData);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => { load(); }, []);

  async function handleAddSource() {
    if (!newSourceUrl.trim()) return;
    try {
      await actions.addBanlistSource(newSourceUrl.trim(), newSourcePolicy);
      setNewSourceUrl("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRemoveSource(url: string) {
    try {
      await actions.removeBanlistSource(url);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handlePolicyChange(url: string, policy: "hard-reject" | "soft-flag") {
    try {
      await actions.updateBanlistSourcePolicy(url, policy);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handlePublishToggle(checked: boolean) {
    try {
      await actions.setBanlistPublish(checked);
      setPublishBanlist(checked);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleAddOverride() {
    if (!newOverridePubkey.trim()) return;
    try {
      await actions.addBanlistOverride(
        newOverridePubkey.trim(),
        newOverrideType,
        newOverrideReason.trim() || undefined,
      );
      setNewOverridePubkey("");
      setNewOverrideReason("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRemoveOverride(pubkey: string) {
    try {
      await actions.removeBanlistOverride(pubkey);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="settings-section">
      <h2>{t("hub.admin.banlist.title")}</h2>
      {error && <p className="error-text">{error}</p>}

      <h3>{t("hub.admin.banlist.sources")}</h3>
      {sources.length === 0 && <p className="muted">{t("hub.admin.banlist.sources_empty")}</p>}
      {sources.length > 0 && (
        <table className="members-table">
          <thead>
            <tr>
              <th>URL</th>
              <th>{t("hub.admin.banlist.col.policy")}</th>
              <th>{t("hub.admin.banlist.col.added")}</th>
              <th>{t("hub.admin.banlist.col.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.url}>
                <td style={{ wordBreak: "break-all" }}>{s.url}</td>
                <td>
                  <select
                    value={s.policy}
                    onChange={(e) =>
                      handlePolicyChange(s.url, e.target.value as "hard-reject" | "soft-flag")
                    }
                  >
                    <option value="hard-reject">{t("hub.admin.banlist.policy.hard")}</option>
                    <option value="soft-flag">{t("hub.admin.banlist.policy.soft")}</option>
                  </select>
                </td>
                <td>{formatRelative(s.added_at)}</td>
                <td>
                  <button
                    className="btn-small btn-secondary danger"
                    onClick={() => handleRemoveSource(s.url)}
                  >
                    {t("hub.admin.banlist.remove")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="settings-row" style={{ marginTop: "var(--space-3)" }}>
        <input
          type="url"
          placeholder="https://hub.example/federation/banlist"
          value={newSourceUrl}
          onChange={(e) => setNewSourceUrl(e.target.value)}
          style={{ flex: 1 }}
        />
        <select
          value={newSourcePolicy}
          onChange={(e) => setNewSourcePolicy(e.target.value as "hard-reject" | "soft-flag")}
        >
          <option value="hard-reject">{t("hub.admin.banlist.policy.hard")}</option>
          <option value="soft-flag">{t("hub.admin.banlist.policy.soft")}</option>
        </select>
        <button onClick={handleAddSource} disabled={!newSourceUrl.trim()}>
          {t("hub.admin.banlist.add_source")}
        </button>
      </div>

      <div className="settings-section">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={publishBanlist}
            onChange={(e) => handlePublishToggle(e.target.checked)}
          />
          {t("hub.admin.banlist.publish")}
        </label>
      </div>

      <h3>
        <button
          className="btn-secondary"
          style={{ fontSize: "inherit", padding: "0 var(--space-1)" }}
          onClick={() => setEntriesOpen((o) => !o)}
          aria-expanded={entriesOpen}
        >
          {entriesOpen ? "▾" : "▸"} {t("hub.admin.banlist.entries.title", { count: entries.length })}
        </button>
      </h3>
      {entriesOpen && (
        entries.length === 0 ? (
          <p className="muted">{t("hub.admin.banlist.entries_empty")}</p>
        ) : (
          <table className="members-table">
            <thead>
              <tr>
                <th>{t("hub.admin.banlist.col.source_hub")}</th>
                <th>{t("hub.admin.banlist.col.target")}</th>
                <th>{t("hub.admin.banlist.col.reason")}</th>
                <th>{t("hub.admin.banlist.col.synced")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, idx) => (
                <tr key={idx}>
                  <td className="member-pk">{e.source_hub_pubkey.slice(0, 8)}</td>
                  <td className="member-pk">{e.target_master_pubkey.slice(0, 8)}</td>
                  <td>{e.reason ?? <span className="muted">—</span>}</td>
                  <td>{formatRelative(e.synced_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      <h3>{t("hub.admin.banlist.overrides")}</h3>
      {overrides.length === 0 && <p className="muted">{t("hub.admin.banlist.overrides_empty")}</p>}
      {overrides.length > 0 && (
        <table className="members-table">
          <thead>
            <tr>
              <th>{t("hub.admin.banlist.col.pubkey")}</th>
              <th>{t("hub.admin.banlist.col.type")}</th>
              <th>{t("hub.admin.banlist.col.reason")}</th>
              <th>{t("hub.admin.banlist.col.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {overrides.map((o) => (
              <tr key={o.target_pubkey}>
                <td className="member-pk">{o.target_pubkey.slice(0, 8)}</td>
                <td>
                  <span className="badge-chip">
                    {o.override_type}
                  </span>
                </td>
                <td>{o.reason ?? <span className="muted">—</span>}</td>
                <td>
                  <button
                    className="btn-small btn-secondary danger"
                    onClick={() => handleRemoveOverride(o.target_pubkey)}
                  >
                    {t("hub.admin.banlist.remove")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="settings-row" style={{ marginTop: "var(--space-3)", flexWrap: "wrap", gap: "var(--space-2)" }}>
        <input
          type="text"
          placeholder={t("hub.admin.banlist.pubkey_placeholder")}
          value={newOverridePubkey}
          onChange={(e) => setNewOverridePubkey(e.target.value)}
          style={{ flex: 1, minWidth: 160 }}
        />
        <select
          value={newOverrideType}
          onChange={(e) => setNewOverrideType(e.target.value as "whitelist" | "blacklist")}
        >
          <option value="whitelist">{t("hub.admin.banlist.override.whitelist")}</option>
          <option value="blacklist">{t("hub.admin.banlist.override.blacklist")}</option>
        </select>
        <input
          type="text"
          placeholder={t("hub.admin.banlist.reason_placeholder")}
          value={newOverrideReason}
          onChange={(e) => setNewOverrideReason(e.target.value)}
          style={{ flex: 1, minWidth: 140 }}
        />
        <button onClick={handleAddOverride} disabled={!newOverridePubkey.trim()}>
          {t("hub.admin.banlist.add_override")}
        </button>
      </div>
    </div>
  );
}
