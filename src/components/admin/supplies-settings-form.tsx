"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SupplySettings } from "@/domain/supplies/types";
import styles from "./admin.module.css";
import suppliesStyles from "./supplies-admin.module.css";

export function SuppliesSettingsForm({ settings, canPublish }: Readonly<{ settings: SupplySettings; canPublish: boolean }>) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);

  async function save() {
    if (!canPublish || pending) return;
    setPending(true); setMessage(""); setSaved(false);
    try {
      const response = await fetch("/api/admin/supplies/settings", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Store visibility could not be saved.");
      setSaved(true); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Store visibility could not be saved."); }
    finally { setPending(false); }
  }

  return <form className={`${styles.formPanel} ${suppliesStyles.stack}`} onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <div className={suppliesStyles.sectionHeading}><div><h2>Public store visibility</h2><p>Publishing a product and enabling the store are separate actions.</p></div><span className={styles.statusBadge}>{settings.enabled ? "Store ON" : "Store OFF"}</span></div>
    <div className={styles.formGrid}><label className={`${styles.checkboxField} ${styles.fullField}`}><input aria-label="Enable Supplies Store" type="checkbox" checked={enabled} onChange={(event) => { setEnabled(event.target.checked); setSaved(false); }} disabled={!canPublish || pending} /><span>Enable Supplies Store</span></label></div>
    <p className={suppliesStyles.hint}>When OFF, public links, catalogue pages and new supplies purchases are unavailable. Admin editing, previews and already-paid orders remain available. When ON, only published products in visible categories can be purchased.</p>
    {!canPublish ? <p className={styles.safetyBanner}>Changing this setting requires the Publish content permission.</p> : null}
    {settings.updatedAt ? <p className={suppliesStyles.hint}>Last changed {new Date(settings.updatedAt).toLocaleString("en-NZ")}{settings.updatedBy ? ` · ${settings.updatedBy}` : ""}.</p> : <p className={suppliesStyles.hint}>The store starts OFF until an authorized administrator enables it.</p>}
    {message ? <p role="alert" className={suppliesStyles.error}>{message}</p> : null}
    {saved ? <p role="status" className={suppliesStyles.success}>Store visibility saved.</p> : null}
    <div className={suppliesStyles.actions}><button className={styles.primaryAdminButton} disabled={!canPublish || pending} type="submit">{pending ? "Saving…" : "Save store visibility"}</button></div>
  </form>;
}
