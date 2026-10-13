import Link from "next/link";
import { SuppliesAdminHeader, SuppliesSchemaPending } from "@/components/admin/supplies-admin-header";
import styles from "@/components/admin/admin.module.css";
import suppliesStyles from "@/components/admin/supplies-admin.module.css";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import { getAdminSuppliesCatalogue } from "@/server/supplies/catalogue";
import { isSuppliesSchemaPendingError } from "@/server/supplies/errors";

export const dynamic = "force-dynamic";
export const metadata = { title: "Supplies | R&R Gallery Admin" };

export default async function SuppliesPage() {
  await requireAdminPage("/admin/supplies", "manage_content");
  const catalogue = await getAdminSuppliesCatalogue().catch((error: unknown) => { if (isSuppliesSchemaPendingError(error)) return null; throw error; });
  return <section className={`${styles.pageSection} ${suppliesStyles.stack}`}>
    <SuppliesAdminHeader title="Supplies" active="overview" description="Manage standard canvas materials and display accessories separately from custom products." actions={<><Link className={styles.secondaryAdminButton} href="/admin/supplies/preview" prefetch={false}>Preview Store</Link><Link className={styles.secondaryAdminButton} href="/admin/supplies/preview?drafts=1" prefetch={false}>Preview Draft Products</Link></>} />
    {catalogue ? <>
      <div className={suppliesStyles.notice}><strong>{catalogue.settings.enabled ? "Store ON" : "Store OFF"}</strong><p>{catalogue.settings.enabled ? "Only published products in visible, active categories are public. Availability and prices are checked by the server." : "The public store and new supplies purchases are unavailable. Manage products and preview your work without enabling the store."}</p><Link href="/admin/supplies/settings">Manage store visibility</Link></div>
      <div className={styles.metricGrid}>{[
        ["Active categories", catalogue.categories.filter((category) => !category.archived).length],
        ["Draft products", catalogue.products.filter((product) => product.status === "draft").length],
        ["Published products", catalogue.products.filter((product) => product.status === "published").length],
        ["Archived products", catalogue.products.filter((product) => product.status === "archived").length],
      ].map(([label, count]) => <div key={label}><span>{label}</span><strong>{count}</strong></div>)}</div>
      <div className={styles.formPanel}><div className={suppliesStyles.sectionHeading}><div><h2>Manage catalogue</h2><p>Create categories first, enter real product prices and availability, then add images and preview before publishing.</p></div></div><div className={suppliesStyles.actions}><Link className={styles.primaryAdminButton} href="/admin/supplies/products/new">New product</Link><Link className={styles.secondaryAdminButton} href="/admin/supplies/categories">Manage categories</Link><Link className={styles.secondaryAdminButton} href="/admin/supplies/products">Manage products</Link></div></div>
    </> : <SuppliesSchemaPending />}
  </section>;
}
