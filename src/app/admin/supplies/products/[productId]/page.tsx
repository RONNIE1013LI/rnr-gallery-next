import { notFound } from "next/navigation";
import { SuppliesAdminHeader, SuppliesSchemaPending } from "@/components/admin/supplies-admin-header";
import { SuppliesProductForm } from "@/components/admin/supplies-product-form";
import styles from "@/components/admin/admin.module.css";
import suppliesStyles from "@/components/admin/supplies-admin.module.css";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import { hasAdminPermission } from "@/server/auth/admin-permissions";
import { getAdminSuppliesCatalogue } from "@/server/supplies/catalogue";
import { isSuppliesSchemaPendingError } from "@/server/supplies/errors";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit supplies product | R&R Gallery Admin" };

export default async function EditProductPage({ params }: Readonly<{ params: Promise<{ productId: string }> }>) {
  const { productId } = await params;
  const access = await requireAdminPage(`/admin/supplies/products/${encodeURIComponent(productId)}`, "manage_content");
  const catalogue = await getAdminSuppliesCatalogue().catch((error: unknown) => { if (isSuppliesSchemaPendingError(error)) return null; throw error; });
  const product = catalogue?.products.find((product) => product.id === productId);
  if (catalogue && !product) notFound();
  return <section className={`${styles.pageSection} ${styles.narrowPage} ${suppliesStyles.stack}`}><SuppliesAdminHeader title="Edit supplies product" active="products" description="Manage product details, variants and images. Existing order snapshots remain unchanged." />{catalogue && product ? <SuppliesProductForm key={product.id} product={product} categories={catalogue.categories} canPublish={hasAdminPermission(access.adminRole, access.adminPermissions, "publish_content")} canManagePrices={hasAdminPermission(access.adminRole, access.adminPermissions, "manage_prices")} canDeleteMedia={hasAdminPermission(access.adminRole, access.adminPermissions, "delete_media")} /> : <SuppliesSchemaPending />}</section>;
}
