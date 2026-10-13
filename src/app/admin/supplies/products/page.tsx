import Link from "next/link";
import { SuppliesAdminHeader, SuppliesSchemaPending } from "@/components/admin/supplies-admin-header";
import { SuppliesProductList } from "@/components/admin/supplies-product-list";
import styles from "@/components/admin/admin.module.css";
import suppliesStyles from "@/components/admin/supplies-admin.module.css";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import { getAdminSuppliesCatalogue } from "@/server/supplies/catalogue";
import { isSuppliesSchemaPendingError } from "@/server/supplies/errors";

export const dynamic = "force-dynamic";
export const metadata = { title: "Supplies products | R&R Gallery Admin" };

export default async function ProductsPage() {
  await requireAdminPage("/admin/supplies/products", "manage_content");
  const catalogue = await getAdminSuppliesCatalogue().catch((error: unknown) => { if (isSuppliesSchemaPendingError(error)) return null; throw error; });
  return <section className={`${styles.pageSection} ${suppliesStyles.stack}`}><SuppliesAdminHeader title="Supplies products" active="products" description="Manage real standard-product prices, variants, stock and shipping information." actions={catalogue ? <Link className={styles.primaryAdminButton} href="/admin/supplies/products/new">New product</Link> : undefined} />{catalogue ? <SuppliesProductList categories={catalogue.categories} products={catalogue.products} /> : <SuppliesSchemaPending />}</section>;
}
