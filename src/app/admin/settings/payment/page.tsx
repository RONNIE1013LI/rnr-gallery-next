import Link from "next/link";
import styles from "@/components/admin/admin.module.css";
import { getAdminPaymentStatus } from "@/server/admin/admin-system-status";
import { requireAdminPage } from "@/server/auth/require-admin-page";

export const metadata = { title: "Payment settings | R&R Gallery Admin" };

export default async function AdminPaymentSettingsPage() {
  await requireAdminPage("/admin/settings/payment", "manage_payment");
  const status = getAdminPaymentStatus();
  return <section className={`${styles.pageSection} ${styles.narrowPage}`}>
    <header className={styles.pageHeader}><div><nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><span>Payment</span></nav><h1>Payment providers</h1><p>Safe configuration status only. Credentials are never shown, stored in content, or editable through the browser.</p></div></header>
    <div className={styles.safetyBanner} role="note"><strong>Payment configuration remains deployment-controlled.</strong><p>Changing provider credentials requires a verified deployment update. Refund controls remain unavailable because the current provider adapters declare refunds unsupported.</p></div>
    <div className={styles.settingsGrid}>{status.providers.map((provider) => <article className={styles.panel} key={provider.key}><div className={styles.settingsHeading}><h2>{provider.label}</h2><span className={provider.enabled ? styles.enabledBadge : styles.disabledBadge}>{provider.enabled ? "Configured" : "Unavailable"}</span></div><dl className={styles.stackedDefinitionList}><div><dt>Environment</dt><dd>{provider.environment}</dd></div>{provider.market ? <div><dt>Market</dt><dd>{provider.market}</dd></div> : null}</dl></article>)}</div>
    <section className={styles.panel}><h2>Operations</h2><dl className={styles.stackedDefinitionList}><div><dt>Return origin</dt><dd>{status.returnOrigin ?? "Not configured"}</dd></div><div><dt>Reconciliation authentication</dt><dd>{status.reconciliationConfigured ? "Configured" : "Not configured"}</dd></div><div><dt>Local test payments</dt><dd>{status.localTestEnabled ? "Enabled — development only" : "Disabled"}</dd></div></dl></section>
  </section>;
}
