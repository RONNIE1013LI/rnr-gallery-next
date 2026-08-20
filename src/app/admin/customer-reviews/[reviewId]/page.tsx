import Link from "next/link";
import { notFound } from "next/navigation";

import { CustomerReviewForm } from "@/components/admin/customer-review-form";
import styles from "@/components/admin/admin.module.css";
import { getProductRegistryRuntime } from "@/server/admin/product-registry-runtime";
import { hasAdminPermission } from "@/server/auth/admin-permissions";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import { getCustomerReviewRuntime } from "@/server/customer-reviews/customer-review-runtime";

type Props = Readonly<{ params: Promise<{ reviewId: string }> }>;
export const metadata = { title: "Edit customer review | R&R Gallery Admin" };
export const dynamic = "force-dynamic";

export default async function EditCustomerReviewPage({ params }: Props) {
  const { reviewId } = await params;
  const access = await requireAdminPage(`/admin/customer-reviews/${encodeURIComponent(reviewId)}`, "manage_reviews");
  const [review, productState] = await Promise.all([
    getCustomerReviewRuntime().getAdmin(reviewId),
    getProductRegistryRuntime().current(),
  ]);
  if (!review) notFound();
  const canPublish = hasAdminPermission(access.adminRole, access.adminPermissions, "publish_reviews");
  return <section className={`${styles.pageSection} ${styles.narrowPage}`}><header className={styles.pageHeader}><div><nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><Link href="/admin/customer-reviews">Customer reviews</Link><span>/</span><span>Edit</span></nav><h1>Edit customer review</h1><p>Publishing and permission changes are enforced again by the server.</p></div></header><CustomerReviewForm review={review} canPublish={canPublish} products={productState.registry.products.filter((product) => product.active).map((product) => ({ key: product.key, title: product.title }))} /></section>;
}
