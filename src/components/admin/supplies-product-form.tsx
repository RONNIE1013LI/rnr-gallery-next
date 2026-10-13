"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SupplyCategory, SupplyProduct, SupplyStatus, SupplyVariant } from "@/domain/supplies/types";
import { createClientId } from "@/lib/client-id";
import { MoneyCentsInput } from "./money-cents-input";
import { SuppliesImages } from "./supplies-images";
import styles from "./admin.module.css";
import suppliesStyles from "./supplies-admin.module.css";

type VariantEditor = Omit<SupplyVariant, "id" | "productId" | "options"> & { id?: string; key: string; optionPairs: { name: string; value: string }[] };

function variantEditors(product?: SupplyProduct): VariantEditor[] {
  return (product?.variants ?? []).map((variant) => ({
    id: variant.id, key: variant.id, sku: variant.sku, label: variant.label, priceCents: variant.priceCents, salePriceCents: variant.salePriceCents,
    active: variant.active, trackInventory: variant.trackInventory, stockQuantity: variant.stockQuantity, available: variant.available,
    weightGrams: variant.weightGrams, packedLengthMm: variant.packedLengthMm, packedWidthMm: variant.packedWidthMm, packedHeightMm: variant.packedHeightMm,
    sortOrder: variant.sortOrder, optionPairs: Object.entries(variant.options).map(([name, value]) => ({ name, value })),
  }));
}

function nullableNumber(data: FormData, name: string) {
  const value = String(data.get(name) ?? "").trim();
  return value ? Number(value) : null;
}

function PackagingFields({ product, prefix = "" }: Readonly<{ product?: SupplyProduct; prefix?: string }>) {
  return <>
    {([ ["weightGrams", "Packed weight (g)"], ["packedLengthMm", "Packed length (mm)"], ["packedWidthMm", "Packed width (mm)"], ["packedHeightMm", "Packed height (mm)"] ] as const).map(([field, label]) => <label key={field}><span>{label}</span><input aria-label={`${prefix}${label}`} name={field} type="number" min={1} max={field === "weightGrams" ? 1000000 : 20000} step={1} defaultValue={product?.[field] ?? ""} /></label>)}
  </>;
}

export function SuppliesProductForm({ product: incomingProduct, categories, canPublish, canDeleteMedia, canManagePrices }: Readonly<{ product?: SupplyProduct; categories: readonly SupplyCategory[]; canPublish: boolean; canDeleteMedia: boolean; canManagePrices: boolean }>) {
  const router = useRouter();
  // Keep stock baselines with the draft; route refreshes must not advance them independently.
  const [product, setProduct] = useState(incomingProduct);
  const [formRevision, setFormRevision] = useState(0);
  const [priceCents, setPriceCents] = useState(product?.priceCents ?? 0);
  const [hasSale, setHasSale] = useState(product?.salePriceCents != null);
  const [salePriceCents, setSalePriceCents] = useState(product?.salePriceCents ?? 0);
  const [trackInventory, setTrackInventory] = useState(product?.trackInventory ?? false);
  const [variants, setVariants] = useState<VariantEditor[]>(() => variantEditors(product));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const gstCents = Math.round((hasSale ? salePriceCents : priceCents) * 3 / 23);
  const usableCategories = categories.filter((category) => !category.archived || category.id === product?.categoryId);

  function updateVariant(key: string, change: Partial<VariantEditor>) {
    setVariants((current) => current.map((variant) => variant.key === key ? { ...variant, ...change } : variant));
    setSaved(false);
  }

  function addVariant() {
    setVariants((current) => [...current, { key: createClientId(), sku: "", label: "", priceCents, salePriceCents: null, active: true, trackInventory: false, stockQuantity: null, available: true, weightGrams: null, packedLengthMm: null, packedWidthMm: null, packedHeightMm: null, sortOrder: current.length, optionPairs: [{ name: "", value: "" }] }]);
  }

  async function save(form: HTMLFormElement, status: SupplyStatus) {
    if (pending || !canManagePrices) return;
    setMessage(""); setSaved(false);
    if (hasSale && (salePriceCents <= 0 || salePriceCents >= priceCents)) { setMessage("Sale price must be below the retail price."); return; }
    if (variants.some((variant) => variant.salePriceCents != null && (variant.salePriceCents <= 0 || variant.salePriceCents >= variant.priceCents))) { setMessage("Every variant sale price must be below its retail price."); return; }
    for (const variant of variants) {
      const pairs = variant.optionPairs.filter((pair) => pair.name.trim() || pair.value.trim());
      if (pairs.some((pair) => !pair.name.trim() || !pair.value.trim()) || new Set(pairs.map((pair) => pair.name.trim())).size !== pairs.length) { setMessage("Variant options need unique names and a value for each option."); return; }
    }
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    setPending(true);
    try {
      const input = {
        categoryId: String(data.get("categoryId") ?? ""), title: String(data.get("title") ?? ""), slug: String(data.get("slug") ?? ""), sku: String(data.get("sku") ?? ""),
        shortDescription: String(data.get("shortDescription") ?? ""), description: String(data.get("description") ?? ""), status, priceCents, salePriceCents: hasSale ? salePriceCents : null,
        trackInventory, stockQuantity: trackInventory ? nullableNumber(data, "stockQuantity") : null, available: data.get("available") === "on",
        ...(product ? { expectedStockQuantity: product.stockQuantity } : {}),
        weightGrams: nullableNumber(data, "weightGrams"), packedLengthMm: nullableNumber(data, "packedLengthMm"), packedWidthMm: nullableNumber(data, "packedWidthMm"), packedHeightMm: nullableNumber(data, "packedHeightMm"),
        pickupAllowed: data.get("pickupAllowed") === "on", shippingAllowed: data.get("shippingAllowed") === "on", seoTitle: String(data.get("seoTitle") ?? ""), seoDescription: String(data.get("seoDescription") ?? ""), sortOrder: Number(data.get("sortOrder") ?? 0), featured: data.get("featured") === "on",
        variants: variants.map((variant, index) => ({
          id: variant.id, sku: variant.sku, label: variant.label, priceCents: variant.priceCents, salePriceCents: variant.salePriceCents,
          active: variant.active, trackInventory: variant.trackInventory, stockQuantity: variant.trackInventory ? variant.stockQuantity : null, available: variant.available,
          ...(variant.id ? { expectedStockQuantity: product?.variants.find((original) => original.id === variant.id)?.stockQuantity ?? null } : {}),
          weightGrams: variant.weightGrams, packedLengthMm: variant.packedLengthMm, packedWidthMm: variant.packedWidthMm, packedHeightMm: variant.packedHeightMm,
          sortOrder: index, options: Object.fromEntries(variant.optionPairs.filter((pair) => pair.name.trim() && pair.value.trim()).map((pair) => [pair.name.trim(), pair.value.trim()])),
        })),
      };
      const response = await fetch(product ? `/api/admin/supplies/products/${encodeURIComponent(product.id)}` : "/api/admin/supplies/products", { method: product ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Product could not be saved.");
      const persistedProduct = payload?.product as SupplyProduct | undefined;
      if (!persistedProduct?.id || !Array.isArray(persistedProduct.variants)) throw new Error("The saved product details were not returned. Reload before saving again.");
      setProduct(persistedProduct);
      setPriceCents(persistedProduct.priceCents);
      setHasSale(persistedProduct.salePriceCents != null);
      setSalePriceCents(persistedProduct.salePriceCents ?? 0);
      setTrackInventory(persistedProduct.trackInventory);
      setVariants(variantEditors(persistedProduct));
      setFormRevision((revision) => revision + 1);
      if (!product) {
        router.push(`/admin/supplies/products/${encodeURIComponent(persistedProduct.id)}`);
      }
      setSaved(true); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Product could not be saved."); }
    finally { setPending(false); }
  }

  async function archive() {
    if (!product || pending || !window.confirm(`Archive ${product.title}? It will no longer be publicly available.`)) return;
    setPending(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/supplies/products/${encodeURIComponent(product.id)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Product could not be archived.");
      router.push("/admin/supplies/products"); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Product could not be archived."); }
    finally { setPending(false); }
  }

  return <div className={suppliesStyles.stack}>
    <form key={formRevision} inert={pending} className={suppliesStyles.stack} onChange={() => setSaved(false)} onSubmit={(event) => {
      event.preventDefault();
      const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("data-status") as SupplyStatus | null;
      void save(event.currentTarget, action ?? "draft");
    }}>
      {product ? <div className={suppliesStyles.notice}><strong>Current status: {product.status[0].toUpperCase() + product.status.slice(1)}</strong><p>Saving as draft hides this product. Publishing does not enable the store master switch.</p></div> : null}
      {!canPublish ? <p className={styles.safetyBanner}>You can save drafts. Publishing requires the Publish content permission.</p> : null}
      {!canManagePrices ? <p className={styles.safetyBanner}>Saving products and variant pricing requires the Manage prices permission. You can view product details and manage permitted media.</p> : null}
      <section className={styles.formPanel}>
        <div className={suppliesStyles.sectionHeading}><div><h2>Basic information</h2><p>Use actual product information. For roll-up hardware, clearly state “Stand Only — No Printed Banner Included”.</p></div></div>
        <div className={styles.formGrid}>
          <label className={styles.fullField}><span>Product title</span><input aria-label="Product title" name="title" defaultValue={product?.title ?? ""} maxLength={200} required /></label>
          <label><span>Category</span><select aria-label="Category" name="categoryId" defaultValue={product?.categoryId ?? ""} required><option value="">Choose category</option>{usableCategories.map((category) => <option value={category.id} key={category.id}>{category.name}{category.archived ? " (archived)" : category.visible ? "" : " (hidden)"}</option>)}</select>{!usableCategories.length ? <small><Link href="/admin/supplies/categories">Create a category first</Link></small> : null}</label>
          <label><span>SKU</span><input aria-label="SKU" name="sku" defaultValue={product?.sku ?? ""} maxLength={100} required /></label>
          <label><span>Public slug</span><input aria-label="Public slug" name="slug" defaultValue={product?.slug ?? ""} maxLength={160} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required /><small>Keep published slugs stable. Lowercase letters, numbers and hyphens.</small></label>
          <label><span>Display order</span><input aria-label="Product display order" name="sortOrder" type="number" min={0} max={100000} step={1} defaultValue={product?.sortOrder ?? 0} required /></label>
          <label className={styles.fullField}><span>Short description</span><textarea aria-label="Short description" name="shortDescription" rows={3} defaultValue={product?.shortDescription ?? ""} maxLength={600} /></label>
          <label className={styles.fullField}><span>Detailed description</span><textarea aria-label="Detailed description" name="description" rows={7} defaultValue={product?.description ?? ""} maxLength={30000} /></label>
          <label className={styles.checkboxField}><input name="featured" type="checkbox" defaultChecked={product?.featured ?? false} /><span>Featured product</span></label>
        </div>
      </section>
      <section className={styles.formPanel}>
        <div className={suppliesStyles.sectionHeading}><div><h2>NZD pricing</h2><p>All retail and sale prices include 15% GST. Variants use their own prices when selected.</p></div></div>
        <div className={styles.formGrid}>
          <label><span>Retail price including GST</span><MoneyCentsInput ariaLabel="NZD retail price including GST" cents={priceCents} onCentsChange={setPriceCents} disabled={!canManagePrices} required /></label>
          <label className={styles.checkboxField}><input aria-label="Use a sale price" type="checkbox" checked={hasSale} onChange={(event) => setHasSale(event.target.checked)} /><span>Use a sale price</span></label>
          {hasSale ? <label><span>Sale price including GST</span><MoneyCentsInput ariaLabel="NZD sale price including GST" cents={salePriceCents} onCentsChange={setSalePriceCents} disabled={!canManagePrices} required /></label> : null}
        </div>
        <p className={styles.fieldHint}>GST component: ${(gstCents / 100).toFixed(2)} · Price excluding GST: ${(((hasSale ? salePriceCents : priceCents) - gstCents) / 100).toFixed(2)}. NZ only.</p>
      </section>
      <section className={styles.formPanel}>
        <div className={suppliesStyles.sectionHeading}><div><h2>Variants</h2><p>Optional sizes, lengths or colours. No variants means customers buy the base product.</p></div><button type="button" className={styles.secondaryAdminButton} disabled={pending || variants.length >= 100} onClick={addVariant}>Add variant</button></div>
        <div className={suppliesStyles.stack}>{variants.map((variant, index) => {
          const prefix = `Variant ${index + 1}`;
          return <fieldset className={suppliesStyles.variant} key={variant.key}>
            <legend>{prefix}</legend>
            <div className={styles.formGrid}>
              <label><span>Label</span><input aria-label={`${prefix} label`} value={variant.label} onChange={(event) => updateVariant(variant.key, { label: event.target.value })} maxLength={160} required /></label>
              <label><span>SKU</span><input aria-label={`${prefix} SKU`} value={variant.sku} onChange={(event) => updateVariant(variant.key, { sku: event.target.value })} maxLength={100} required /></label>
              <label><span>Retail price incl. GST</span><MoneyCentsInput ariaLabel={`${prefix} retail price including GST`} cents={variant.priceCents} onCentsChange={(value) => updateVariant(variant.key, { priceCents: value })} disabled={!canManagePrices} required /></label>
              <label className={styles.checkboxField}><input aria-label={`${prefix} use a sale price`} type="checkbox" checked={variant.salePriceCents != null} onChange={(event) => updateVariant(variant.key, { salePriceCents: event.target.checked ? 0 : null })} /><span>Use a sale price</span></label>
              {variant.salePriceCents != null ? <label><span>Sale price incl. GST</span><MoneyCentsInput ariaLabel={`${prefix} sale price including GST`} cents={variant.salePriceCents} onCentsChange={(value) => updateVariant(variant.key, { salePriceCents: value })} disabled={!canManagePrices} required /></label> : null}
              <label className={styles.checkboxField}><input aria-label={`${prefix} active`} type="checkbox" checked={variant.active} onChange={(event) => updateVariant(variant.key, { active: event.target.checked })} /><span>Active variant</span></label>
              <div className={`${styles.fullField} ${suppliesStyles.stack}`}>{variant.optionPairs.map((pair, optionIndex) => <div className={suppliesStyles.optionRow} key={optionIndex}>
                <label><span>Option name</span><input aria-label={`${prefix} option name ${optionIndex + 1}`} placeholder="e.g. Size" maxLength={60} value={pair.name} onChange={(event) => updateVariant(variant.key, { optionPairs: variant.optionPairs.map((option, i) => i === optionIndex ? { ...option, name: event.target.value } : option) })} /></label>
                <label><span>Option value</span><input aria-label={`${prefix} option value ${optionIndex + 1}`} placeholder="e.g. 600 mm" maxLength={100} value={pair.value} onChange={(event) => updateVariant(variant.key, { optionPairs: variant.optionPairs.map((option, i) => i === optionIndex ? { ...option, value: event.target.value } : option) })} /></label>
                <button type="button" className={styles.secondaryAdminButton} aria-label={`Remove ${prefix.toLowerCase()} option ${optionIndex + 1}`} onClick={() => updateVariant(variant.key, { optionPairs: variant.optionPairs.filter((_, i) => i !== optionIndex) })}>Remove</button>
              </div>)}<div><button type="button" className={styles.secondaryAdminButton} onClick={() => updateVariant(variant.key, { optionPairs: [...variant.optionPairs, { name: "", value: "" }] })}>Add option axis</button></div></div>
              <label className={styles.checkboxField}><input aria-label={`${prefix} available`} type="checkbox" checked={variant.available} onChange={(event) => updateVariant(variant.key, { available: event.target.checked })} /><span>Available</span></label>
              <label className={styles.checkboxField}><input aria-label={`${prefix} track inventory`} type="checkbox" checked={variant.trackInventory} onChange={(event) => updateVariant(variant.key, { trackInventory: event.target.checked, stockQuantity: event.target.checked ? variant.stockQuantity ?? 0 : null })} /><span>Track inventory</span></label>
              {variant.trackInventory ? <label><span>Available stock</span><input aria-label={`${prefix} stock quantity`} type="number" min={0} max={1000000} step={1} value={variant.stockQuantity ?? 0} onChange={(event) => updateVariant(variant.key, { stockQuantity: Number(event.target.value) })} required /><small>Excludes quantities already reserved by pending orders.</small></label> : null}
              {([ ["weightGrams", "Packed weight (g)"], ["packedLengthMm", "Packed length (mm)"], ["packedWidthMm", "Packed width (mm)"], ["packedHeightMm", "Packed height (mm)"] ] as const).map(([field, label]) => <label key={field}><span>{label}</span><input aria-label={`${prefix} ${label}`} type="number" min={1} max={field === "weightGrams" ? 1000000 : 20000} step={1} value={variant[field] ?? ""} onChange={(event) => updateVariant(variant.key, { [field]: event.target.value ? Number(event.target.value) : null })} /><small>Leave blank to use product packaging.</small></label>)}
            </div>
            <div className={suppliesStyles.actions}><button type="button" className={styles.secondaryAdminButton} aria-label={`Remove ${prefix.toLowerCase()}`} onClick={() => setVariants((current) => current.filter((item) => item.key !== variant.key))}>Remove variant</button><button type="button" className={styles.secondaryAdminButton} disabled={index === 0} aria-label={`Move ${prefix.toLowerCase()} earlier`} onClick={() => setVariants((current) => { const result = [...current]; [result[index - 1], result[index]] = [result[index], result[index - 1]]; return result; })}>Move earlier</button></div>
          </fieldset>;
        })}{!variants.length ? <p className={suppliesStyles.hint}>No variants. The base price and inventory apply.</p> : null}</div>
      </section>
      <section className={styles.formPanel}>
        <div className={suppliesStyles.sectionHeading}><div><h2>Inventory</h2><p>Enter sellable stock excluding quantities already reserved by pending orders. Mark unavailable items explicitly. Checkout verifies tracked stock on the server.</p></div></div>
        <div className={styles.formGrid}>
          <label className={styles.checkboxField}><input aria-label="Product available" name="available" type="checkbox" defaultChecked={product?.available ?? true} /><span>Available for purchase</span></label>
          <label className={styles.checkboxField}><input aria-label="Track product inventory" type="checkbox" checked={trackInventory} onChange={(event) => setTrackInventory(event.target.checked)} /><span>Track product inventory</span></label>
          {trackInventory ? <label><span>Available stock</span><input aria-label="Product stock quantity" name="stockQuantity" type="number" min={0} max={1000000} step={1} defaultValue={product?.stockQuantity ?? 0} required /></label> : null}
        </div>
      </section>
      <section className={styles.formPanel}>
        <div className={suppliesStyles.sectionHeading}><div><h2>Shipping and pickup</h2><p>Enter actual packed weight and dimensions. Shipping is quoted by the existing NZ shipping service using this packaging.</p></div></div>
        <div className={styles.formGrid}><label className={styles.checkboxField}><input aria-label="Pickup allowed" name="pickupAllowed" type="checkbox" defaultChecked={product?.pickupAllowed ?? true} /><span>Pickup allowed</span></label><label className={styles.checkboxField}><input aria-label="Shipping allowed" name="shippingAllowed" type="checkbox" defaultChecked={product?.shippingAllowed ?? false} /><span>NZ shipping allowed</span></label><PackagingFields product={product} /></div>
      </section>
      <section className={styles.formPanel}>
        <div className={suppliesStyles.sectionHeading}><div><h2>Search presentation</h2><p>Optional SEO overrides. Images have separate editable alt text below.</p></div></div>
        <div className={styles.formGrid}><label className={styles.fullField}><span>SEO title</span><input aria-label="SEO title" name="seoTitle" defaultValue={product?.seoTitle ?? ""} maxLength={200} /></label><label className={styles.fullField}><span>Meta description</span><textarea aria-label="Meta description" name="seoDescription" defaultValue={product?.seoDescription ?? ""} maxLength={400} rows={3} /></label></div>
      </section>
      {message ? <p role="alert" className={suppliesStyles.error}>{message}</p> : null}{saved ? <p role="status" className={suppliesStyles.success}>Product saved.</p> : null}
      <div className={styles.formPanel}><div className={suppliesStyles.actions}>
        <button type="submit" data-status="draft" disabled={pending || !canManagePrices} className={styles.secondaryAdminButton}>{pending ? "Saving…" : "Save draft"}</button>
        {canPublish ? <button type="submit" data-status="published" disabled={pending || !canManagePrices} className={styles.primaryAdminButton}>{product?.status === "published" ? "Save published product" : "Publish product"}</button> : null}
        {product && product.status !== "archived" ? <button type="button" disabled={pending} className={styles.secondaryAdminButton} onClick={() => void archive()}>Archive product</button> : null}
        {product ? <Link className={styles.secondaryAdminButton} href={`/admin/supplies/preview/products/${encodeURIComponent(product.slug)}?drafts=1`} prefetch={false}>Preview product</Link> : null}
        <Link href="/admin/supplies/products">Back to products</Link>
      </div></div>
    </form>
    <section className={styles.formPanel}>
      <div className={suppliesStyles.sectionHeading}><div><h2>Product images</h2><p>Select one cover and arrange supporting detail images. Images are saved separately from product fields.</p></div></div>
      {incomingProduct ? <SuppliesImages productId={incomingProduct.id} images={incomingProduct.images} canDelete={canDeleteMedia} /> : <p className={suppliesStyles.hint}>Save the product as a draft to upload and manage its images here.</p>}
    </section>
  </div>;
}
