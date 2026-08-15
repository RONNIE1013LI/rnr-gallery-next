import Link from "next/link";
import { ProductRegistryForm } from "@/components/admin/product-registry-form";
import styles from "@/components/admin/admin.module.css";
import { listAdminProducts } from "@/server/admin/product-admin-service";
import { getProductRegistryRuntime } from "@/server/admin/product-registry-runtime";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import { getMarketCompleteness } from "@/domain/catalogue/market-price-book";

export const metadata = { title: "Products & pricing | R&R Gallery Admin" };

export default async function AdminProductsPage() {
  await requireAdminPage("/admin/products", "manage_prices");
  const { revision, registry } = await getProductRegistryRuntime().current();
  const products = listAdminProducts(registry);

  return (
    <section className={styles.pageSection}>
      <header className={styles.pageHeader}>
        <div>
          <nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><span>Products</span></nav>
          <h1>Products &amp; pricing</h1>
          <p>Live catalogue and pricing rules currently used by product configuration and server checkout repricing.</p>
        </div>
        <span className={styles.recordCount}>{products.length} products</span>
      </header>

      <div className={styles.safetyBanner} role="note">
        <strong>One authoritative registry · revision {revision}</strong>
        <p>Publishing updates the storefront, configuration preview and server checkout repricing together. Existing order snapshots never change.</p>
      </div>
      <ProductRegistryForm
        products={products}
        pricing={registry.pricing}
        markets={registry.markets}
        australiaCompleteness={getMarketCompleteness(registry, "AU")}
        revision={revision}
      />
    </section>
  );
}
