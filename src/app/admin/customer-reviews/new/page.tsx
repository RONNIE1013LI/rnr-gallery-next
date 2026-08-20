import Link from "next/link";

import { CustomerReviewForm } from "@/components/admin/customer-review-form";
import styles from "@/components/admin/admin.module.css";
import { hasAdminPermission } from "@/server/auth/admin-permissions";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import { getProductRegistryRuntime } from "@/server/admin/product-registry-runtime";

export const metadata = { title: "New customer review | R&R Gallery Admin" };

export default async function NewCustomerReviewPage() {
  const access = await requireAdminPage("/admin/customer-reviews/new", "manage_reviews");
  const { registry } = await getProductRegistryRuntime().current();
  const canPublish = hasAdminPermission(access.adminRole, access.adminPermissions, "publish_reviews");
  return <section className={`${styles.pageSection} ${styles.narrowPage}`}><header className={styles.pageHeader}><div><nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><Link href="/admin/customer-reviews">Customer reviews</Link><span>/</span><span>New</span></nav><h1>New customer review</h1><p>Store the original recommendation and record customer permission before publishing.</p></div></header><CustomerReviewForm canPublish={canPublish} products={registry.products.filter((product) => product.active).map((product) => ({ key: product.key, title: product.title }))} /></section>;
}
