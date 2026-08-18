import Link from "next/link";
import styles from "@/components/admin/admin.module.css";
import { requireAdminPage } from "@/server/auth/require-admin-page";

export default async function AdminSettingsPage() {
  await requireAdminPage("/admin/settings", "access_admin");
  return <section className={`${styles.pageSection} ${styles.narrowPage}`}>
    <header className={styles.pageHeader}><div><nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><span>Settings</span></nav><h1>Settings</h1><p>Operational provider readiness. Sensitive credentials remain outside browser-accessible storage.</p></div></header>
    <div className={styles.settingsGrid}><Link className={styles.settingsLink} href="/admin/settings/shipping"><span>Shipping</span><strong>Quotes, destinations and pickup readiness</strong></Link><Link className={styles.settingsLink} href="/admin/settings/payment"><span>Payment</span><strong>Card and Afterpay readiness</strong></Link></div>
  </section>;
}
