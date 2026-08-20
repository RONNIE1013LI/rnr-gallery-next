import Link from "next/link";

import { CustomerReviewList } from "@/components/admin/customer-review-list";
import { FacebookReviewSummaryForm } from "@/components/admin/facebook-review-summary-form";
import styles from "@/components/admin/admin.module.css";
import { hasAdminPermission } from "@/server/auth/admin-permissions";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import { getCustomerReviewRuntime } from "@/server/customer-reviews/customer-review-runtime";

export const metadata = { title: "Customer reviews | R&R Gallery Admin" };
export const dynamic = "force-dynamic";

export default async function AdminCustomerReviewsPage() {
  const access = await requireAdminPage("/admin/customer-reviews", "manage_reviews");
  const service = getCustomerReviewRuntime();
  const [reviews, settings] = await Promise.all([service.listAdmin(), service.getSettings()]);
  const canPublish = hasAdminPermission(access.adminRole, access.adminPermissions, "publish_reviews");

  return <section className={styles.pageSection}>
    <header className={styles.pageHeader}><div><nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><span>Customer reviews</span></nav><h1>Customer reviews</h1><p>Manually manage approved Facebook recommendations, publishing consent and permanent review media.</p></div><Link className={styles.primaryAdminButton} href="/admin/customer-reviews/new">New review</Link></header>
    {!canPublish ? <p className={styles.safetyBanner}>You can manage drafts. Publishing requires the independent Publish reviews permission.</p> : null}
    <FacebookReviewSummaryForm settings={settings} canPublish={canPublish} />
    <CustomerReviewList reviews={reviews} />
  </section>;
}
