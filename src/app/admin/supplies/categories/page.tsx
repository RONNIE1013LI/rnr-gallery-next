import { SuppliesAdminHeader, SuppliesSchemaPending } from "@/components/admin/supplies-admin-header";
import { SuppliesCategories } from "@/components/admin/supplies-categories";
import styles from "@/components/admin/admin.module.css";
import suppliesStyles from "@/components/admin/supplies-admin.module.css";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import { hasAdminPermission } from "@/server/auth/admin-permissions";
import { getAdminSuppliesCatalogue } from "@/server/supplies/catalogue";
import { isSuppliesSchemaPendingError } from "@/server/supplies/errors";

export const dynamic = "force-dynamic";
export const metadata = { title: "Supplies categories | R&R Gallery Admin" };

export default async function CategoriesPage() {
  const access = await requireAdminPage("/admin/supplies/categories", "manage_content");
  const catalogue = await getAdminSuppliesCatalogue().catch((error: unknown) => { if (isSuppliesSchemaPendingError(error)) return null; throw error; });
  return <section className={`${styles.pageSection} ${suppliesStyles.stack}`}><SuppliesAdminHeader title="Supplies categories" active="categories" description="Create categories, manage images, set their order and control visibility." />{catalogue ? <SuppliesCategories categories={catalogue.categories} canPublish={hasAdminPermission(access.adminRole, access.adminPermissions, "publish_content")} canDeleteMedia={hasAdminPermission(access.adminRole, access.adminPermissions, "delete_media")} /> : <SuppliesSchemaPending />}</section>;
}
