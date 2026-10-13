import { SuppliesAdminHeader, SuppliesSchemaPending } from "@/components/admin/supplies-admin-header";
import { SuppliesProductForm } from "@/components/admin/supplies-product-form";
import styles from "@/components/admin/admin.module.css";
import suppliesStyles from "@/components/admin/supplies-admin.module.css";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import { hasAdminPermission } from "@/server/auth/admin-permissions";
import { getAdminSuppliesCatalogue } from "@/server/supplies/catalogue";
import { isSuppliesSchemaPendingError } from "@/server/supplies/errors";

export const dynamic = "force-dynamic";
export const metadata = { title: "New supplies product | R&R Gallery Admin" };

export default async function NewProductPage() {
  const access = await requireAdminPage("/admin/supplies/products/new", "manage_content");
  const catalogue = await getAdminSuppliesCatalogue().catch((error: unknown) => { if (isSuppliesSchemaPendingError(error)) return null; throw error; });
  return <section className={`${styles.pageSection} ${styles.narrowPage} ${suppliesStyles.stack}`}><SuppliesAdminHeader title="New supplies product" active="products" description="Save a draft, then upload images and preview the actual storefront." />{catalogue ? <SuppliesProductForm categories={catalogue.categories} canPublish={hasAdminPermission(access.adminRole, access.adminPermissions, "publish_content")} canManagePrices={hasAdminPermission(access.adminRole, access.adminPermissions, "manage_prices")} canDeleteMedia={hasAdminPermission(access.adminRole, access.adminPermissions, "delete_media")} /> : <SuppliesSchemaPending />}</section>;
}
