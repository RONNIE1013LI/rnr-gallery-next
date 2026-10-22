import Link from "next/link";
import { WisePayIdPanel } from "@/components/admin/wise-payid-panel";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import styles from "@/components/admin/admin.module.css";
export const metadata = { title: "Wise PayID reconciliation | R&R Gallery Admin" };
export default async function WisePayIdPage() {
  await requireAdminPage("/admin/settings/payment/wise-payid", "manage_payment");
  return <section className={styles.pageSection}><header className={styles.pageHeader}><div>
    <Link href="/admin/settings/payment">Payment settings</Link><h1>Wise AUD PayID reconciliation</h1>
    <p>Review received bank transfers and record payment decisions.</p>
  </div></header><WisePayIdPanel /></section>;
}
