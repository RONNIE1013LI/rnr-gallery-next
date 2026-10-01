import Link from "next/link";
import styles from "@/components/admin/admin.module.css";
import { FlikTestPanel } from "@/components/admin/flik-test-panel";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import { parsePaymentConfig } from "@/server/payments/config";

export const metadata = { title: "Flik test payments | R&R Gallery Admin" };
export default async function AdminFlikTestPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<{ sessionId?: string }> }) {
  await requireAdminPage("/admin/settings/payment/flik", "manage_payment");
  const config = parsePaymentConfig();
  const params = await searchParams;
  const initialSessionId = typeof params.sessionId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.sessionId) ? params.sessionId : undefined;
  const enabled = config.flik?.enabled && config.flik.testMode && config.flik.deployment === "development" && Boolean(config.operations.returnBaseUrl?.startsWith("https://"));
  return <section className={`${styles.pageSection} ${styles.narrowPage}`}>
    <header className={styles.pageHeader}><div><nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin/settings/payment">Payment settings</Link><span>/</span><span>Flik testing</span></nav><h1>Flik test payments</h1><p>Permission-protected testing for the New Zealand bank payment integration.</p></div></header>
    <div className={styles.safetyBanner} role="note"><strong>Test environment only</strong><p>This page cannot create a real customer order or accept a live payment.</p></div>
    <FlikTestPanel enabled={Boolean(enabled)} initialSessionId={initialSessionId} />
  </section>;
}
