import { SuppliesAdminHeader, SuppliesSchemaPending } from "@/components/admin/supplies-admin-header";
import { SuppliesSettingsForm } from "@/components/admin/supplies-settings-form";
import styles from "@/components/admin/admin.module.css";
import suppliesStyles from "@/components/admin/supplies-admin.module.css";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import { hasAdminPermission } from "@/server/auth/admin-permissions";
import { getAdminSuppliesCatalogue } from "@/server/supplies/catalogue";
import { isSuppliesSchemaPendingError } from "@/server/supplies/errors";

export const dynamic = "force-dynamic";
export const metadata = { title: "Supplies settings | R&R Gallery Admin" };

export default async function SettingsPage() {
  const access = await requireAdminPage("/admin/supplies/settings", "manage_content");
  const catalogue = await getAdminSuppliesCatalogue().catch((error: unknown) => { if (isSuppliesSchemaPendingError(error)) return null; throw error; });
  return <section className={`${styles.pageSection} ${styles.narrowPage} ${suppliesStyles.stack}`}><SuppliesAdminHeader title="Supplies settings" active="settings" description="The store starts OFF. Enable it deliberately only when the catalogue and fulfilment are ready." />{catalogue ? <SuppliesSettingsForm key={`${catalogue.settings.enabled}-${catalogue.settings.updatedAt}`} settings={catalogue.settings} canPublish={hasAdminPermission(access.adminRole, access.adminPermissions, "publish_content")} /> : <SuppliesSchemaPending />}</section>;
}
