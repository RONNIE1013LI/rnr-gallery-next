import Link from "next/link";
import styles from "@/components/admin/admin.module.css";
import { getAdminShippingStatus } from "@/server/admin/admin-system-status";
import { requireAdminPage } from "@/server/auth/require-admin-page";

export const metadata = { title: "Shipping settings | R&R Gallery Admin" };

export default async function AdminShippingSettingsPage() {
  await requireAdminPage("/admin/settings/shipping", "manage_shipping");
  const status = getAdminShippingStatus();
  return <section className={`${styles.pageSection} ${styles.narrowPage}`}>
    <header className={styles.pageHeader}><div><nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><span>Shipping</span></nav><h1>Shipping</h1><p>Live provider readiness and service boundaries. Existing checkout quote and address validation logic remains authoritative.</p></div></header>
    <div className={styles.safetyBanner} role="note"><strong>Shipping credentials remain deployment-controlled.</strong><p>This page never exposes credentials and does not create manual rates that could diverge from real-time checkout quotes.</p></div>
    <section className={styles.panel}><div className={styles.settingsHeading}><h2>{status.providerLabel}</h2><span className={status.enabled ? styles.enabledBadge : styles.disabledBadge}>{status.enabled ? "Available" : "Unavailable"}</span></div><dl className={styles.stackedDefinitionList}><div><dt>Environment</dt><dd>{status.environment}</dd></div><div><dt>Rate tax mode</dt><dd>{status.taxMode ?? "Not configured"}</dd></div><div><dt>Provider timeout</dt><dd>{status.timeoutMs.toLocaleString("en-NZ")} ms</dd></div><div><dt>Supported destinations</dt><dd>{status.countries.join(", ")}</dd></div><div><dt>Pickup</dt><dd>{status.pickupAvailable ? "Available" : "Unavailable"}</dd></div></dl></section>
  </section>;
}
