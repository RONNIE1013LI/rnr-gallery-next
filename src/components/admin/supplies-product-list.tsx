"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import type { SupplyCategory, SupplyProduct } from "@/domain/supplies/types";
import styles from "./admin.module.css";
import suppliesStyles from "./supplies-admin.module.css";

export function SuppliesProductList({ products, categories }: Readonly<{ products: readonly SupplyProduct[]; categories: readonly SupplyCategory[] }>) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [categoryId, setCategoryId] = useState("all");
  const query = search.trim().toLowerCase();
  const filtered = products.filter((product) =>
    (status === "all" || product.status === status) && (categoryId === "all" || product.categoryId === categoryId) &&
    (!query || `${product.title} ${product.sku} ${product.slug}`.toLowerCase().includes(query)),
  );
  return <div className={suppliesStyles.stack}>
    <div className={`${styles.formGrid} ${suppliesStyles.filters}`}>
      <label><span>Search products</span><input aria-label="Search products" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Title, SKU or slug" /></label>
      <label><span>Status</span><select aria-label="Product status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label>
      <label><span>Category</span><select aria-label="Product category filter" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="all">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.archived ? " (archived)" : ""}</option>)}</select></label>
    </div>
    <p className={suppliesStyles.hint} role="status">{filtered.length} of {products.length} products</p>
    {!products.length ? <div className={styles.emptyState}><h2>No supplies products yet</h2><p>Add real product information, prices and availability before publishing.</p><Link href="/admin/supplies/products/new">Create the first product</Link></div> : !filtered.length ? <p className={styles.mutedText}>No products match these filters.</p> : <div className={styles.tableScroll}><table className={styles.dataTable}>
      <thead><tr><th>Product</th><th>Category</th><th>NZD incl. GST</th><th>Availability</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>{filtered.map((product) => {
        const cover = product.images.find((image) => image.isCover) ?? product.images[0];
        const activeVariants = product.variants.filter((variant) => variant.active);
        const cents = activeVariants.length ? Math.min(...activeVariants.map((variant) => variant.salePriceCents ?? variant.priceCents)) : product.salePriceCents ?? product.priceCents;
        const availableVariants = activeVariants.filter((variant) => variant.available && (!variant.trackInventory || (variant.stockQuantity ?? 0) > 0));
        const availability = !product.available ? "Unavailable" : product.variants.length ? `${availableVariants.length} of ${activeVariants.length} active variants available` : product.trackInventory ? `${product.stockQuantity ?? 0} in stock` : "Available";
        return <tr key={product.id}>
          <td data-label="Product"><div className={suppliesStyles.productIdentity}>{cover ? <Image src={`/api/admin/supplies/images/${encodeURIComponent(cover.id)}`} alt="" width={52} height={52} unoptimized /> : null}<div><strong>{product.title}</strong><small>{product.sku}</small></div></div></td>
          <td data-label="Category">{categories.find((category) => category.id === product.categoryId)?.name ?? "Unassigned"}</td>
          <td data-label="NZD incl. GST">{product.variants.length && !activeVariants.length ? "No active variants" : <>{activeVariants.length ? "From " : ""}{(cents / 100).toLocaleString("en-NZ", { style: "currency", currency: "NZD" })}</>}</td>
          <td data-label="Availability">{availability}</td>
          <td data-label="Status"><span className={styles.statusBadge}>{product.status[0].toUpperCase() + product.status.slice(1)}</span></td>
          <td data-label="Actions"><div className={suppliesStyles.actions}><Link className={styles.tableAction} href={`/admin/supplies/products/${encodeURIComponent(product.id)}`} aria-label={`Edit ${product.title}`}>Edit</Link><Link className={styles.tableAction} href={`/admin/supplies/preview/products/${encodeURIComponent(product.slug)}?drafts=1`} aria-label={`Preview ${product.title}`} prefetch={false}>Preview</Link></div></td>
        </tr>;
      })}</tbody>
    </table></div>}
  </div>;
}
