"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import type { SuppliesCatalogue, SupplyCategory, SupplyProduct, SupplyInventory } from "@/domain/supplies/types";
import { addCartItem } from "@/domain/cart/cart";
import { createBrowserCartRepository } from "@/domain/cart/browser-cart-repository";
import { notifyCartChanged } from "@/domain/cart/browser-cart-events";
import { createSupplyCartItem } from "@/domain/cart/supply-cart-item";
import { createClientId } from "@/lib/client-id";
import styles from "./supplies-storefront.module.css";

const money = (cents: number) => `NZ$${(cents / 100).toFixed(2)}`;
const inStock = (selection: SupplyInventory) => selection.available && (!selection.trackInventory || (selection.stockQuantity ?? 0) > 0);

export function suppliesHref(path = "", preview = false, includeDrafts = false) {
  return `${preview ? "/admin/supplies/preview" : "/supplies"}${path}${preview && includeDrafts ? "?drafts=1" : ""}`;
}

export function SuppliesEntry() {
  return <aside className={styles.entry} aria-label="Canvas and display supplies">
    <div><h2>Canvas &amp; Display Supplies</h2><p>Shop canvas materials, stretcher bars and display hardware.</p></div>
    <Link className={styles.button} href="/supplies">Supplies &amp; Accessories <span aria-hidden="true">→</span></Link>
  </aside>;
}

export function SuppliesStorefront({ catalogue, category, preview = false, includeDrafts = false }: Readonly<{
  catalogue: SuppliesCatalogue;
  category?: SupplyCategory;
  preview?: boolean;
  includeDrafts?: boolean;
}>) {
  const products = category ? catalogue.products.filter((product) => product.categoryId === category.id) : catalogue.products;
  const Container = preview ? "section" : "main";
  return <Container id={preview ? "supplies-preview-content" : "main-content"} className={styles.page}>
    <nav aria-label="Breadcrumb" className={styles.breadcrumb}><Link href={suppliesHref("", preview, includeDrafts)}>Supplies &amp; Accessories</Link>{category ? <span> / {category.name}</span> : null}</nav>
    <header className={styles.intro}><p className={styles.eyebrow}>SUPPLIES &amp; ACCESSORIES</p><h1>{category?.name ?? "Canvas & Display Supplies"}</h1><p>{category?.description || "Canvas materials and display essentials, ready to order. Available in New Zealand with prices including GST."}</p></header>
    <nav className={styles.categories} aria-label="Supplies categories">
      <Link href={suppliesHref("", preview, includeDrafts)} aria-current={!category ? "page" : undefined}>All Supplies</Link>
      {catalogue.categories.map((item) => <Link key={item.id} href={suppliesHref(`/categories/${item.slug}`, preview, includeDrafts)} aria-current={item.id === category?.id ? "page" : undefined}>{item.name}</Link>)}
    </nav>
    {!category && catalogue.categories.some((item) => item.image) ? <div className={styles.categoryGrid}>
      {catalogue.categories.filter((item) => item.image).map((item) => <Link className={styles.categoryCard} href={suppliesHref(`/categories/${item.slug}`, preview, includeDrafts)} key={item.id}>
        <Image src={item.image!.url} alt={item.image!.altText || item.name} width={item.image!.width} height={item.image!.height} unoptimized />
        <strong>{item.name}</strong>
      </Link>)}
    </div> : null}
    <section className={styles.grid} aria-label="Supplies products">
      {products.map((product) => {
        const image = product.images.find((item) => item.isCover) ?? product.images[0];
        const variants = product.variants.filter((item) => item.active);
        const selections = variants.length ? variants : [product];
        const price = Math.min(...selections.map((item) => item.salePriceCents ?? item.priceCents));
        const available = product.available && selections.some(inStock);
        const categoryName = catalogue.categories.find((item) => item.id === product.categoryId)?.name ?? "";
        return <article key={product.id} className={styles.card}>
          <Link href={suppliesHref(`/products/${product.slug}`, preview, includeDrafts)} className={styles.cardImage} tabIndex={-1} aria-hidden="true">
            {image ? <Image src={image.url} alt={image.altText || product.title} width={image.width} height={image.height} unoptimized /> : <span>Product image coming soon</span>}
          </Link>
          <div className={styles.cardCopy}><p className={styles.eyebrow}>{categoryName}</p><h2>{product.title}</h2>
            {preview && product.status !== "published" ? <p className={styles.badge}>{product.status}</p> : null}
            {isStandOnly(product.title, categoryName) ? <p className={styles.standNotice}>Stand Only — No Printed Banner Included</p> : null}
            <p className={styles.price}>{variants.length > 1 ? "From " : ""}{money(price)} <small>incl. GST</small></p>
            <p className={available ? styles.stock : styles.outOfStock}>{available ? "In stock" : "Out of stock"}</p>
            <Link className={styles.button} href={suppliesHref(`/products/${product.slug}`, preview, includeDrafts)}>View Product</Link>
          </div>
        </article>;
      })}
    </section>
    {!products.length ? <p className={styles.empty}>No products are available in this collection yet.</p> : null}
  </Container>;
}

function isStandOnly(title: string, categoryName: string) {
  return /roll[- ]?up|stand only|stands only/i.test(`${title} ${categoryName}`);
}

export function SupplyProductDetail({ product, categoryName, preview = false, includeDrafts = false }: Readonly<{
  product: SupplyProduct; categoryName: string; preview?: boolean; includeDrafts?: boolean;
}>) {
  const variants = preview ? product.variants : product.variants.filter((variant) => variant.active);
  const [variantId, setVariantId] = useState(variants[0]?.id ?? "");
  const variant = variants.find((item) => item.id === variantId) ?? null;
  const selection = variant ?? product;
  const [quantity, setQuantity] = useState(1);
  const [activeImageId, setActiveImageId] = useState((product.images.find((item) => item.isCover) ?? product.images[0])?.id);
  const image = product.images.find((item) => item.id === activeImageId) ?? product.images[0];
  const [feedback, setFeedback] = useState("");
  const zoom = useRef<HTMLDialogElement>(null);
  const price = selection.salePriceCents ?? selection.priceCents;
  const quantityValid = Number.isInteger(quantity) && quantity >= 1 && quantity <= 999;
  const available = product.available && inStock(selection) && (!variants.length || Boolean(variant?.active));
  const quantityAvailable = !selection.trackInventory || quantity <= (selection.stockQuantity ?? 0);
  const deliveryAvailable = product.pickupAllowed || product.shippingAllowed;
  const canAdd = quantityValid && (preview || (available && quantityAvailable && deliveryAvailable && price > 0));

  function addToCart() {
    if (!canAdd) return;
    if (preview) { setFeedback("Preview only — no items were added to your cart and payment is disabled."); return; }
    try {
      const repository = createBrowserCartRepository(window.localStorage);
      const item = createSupplyCartItem({
        id: createClientId(), productId: product.id, ...(variant ? { variantId: variant.id, variantLabel: variant.label } : {}),
        title: product.title, slug: product.slug, sku: selection.sku, imageSrc: image?.url ?? "", unitPriceCents: price,
        quantity, deliveryPreference: product.shippingAllowed ? "post" : "pickup",
      });
      repository.save(addCartItem(repository.load(), item));
      notifyCartChanged();
      setFeedback("Added to your cart. Prices and stock are checked again at checkout.");
    } catch { setFeedback("Unable to add this item. Please check your quantity and try again."); }
  }

  const Container = preview ? "section" : "main";
  return <Container id={preview ? "supplies-preview-content" : "main-content"} className={styles.page}>
    <nav aria-label="Breadcrumb" className={styles.breadcrumb}><Link href={suppliesHref("", preview, includeDrafts)}>Supplies &amp; Accessories</Link><span> / {product.title}</span></nav>
    <div className={styles.detail}>
      <section className={styles.gallery} aria-label="Product images">
        <button type="button" className={styles.hero} onClick={() => zoom.current?.showModal()} disabled={!image} aria-label="Enlarge product image">
          {image ? <Image src={image.url} alt={image.altText || product.title} width={image.width} height={image.height} unoptimized /> : <span>Product image coming soon</span>}
        </button>
        {image ? <p className={styles.imageHint}>Select an image to enlarge</p> : null}
        {product.images.length > 1 ? <div className={styles.thumbnails}>
          {product.images.map((item, index) => <button key={item.id} type="button" aria-label={`View product image ${index + 1}`} aria-pressed={item.id === image?.id} onClick={() => setActiveImageId(item.id)}>
            <Image src={item.url} alt={item.altText || product.title} width={96} height={96} unoptimized />
          </button>)}
        </div> : null}
        <dialog ref={zoom} className={styles.zoom} aria-label="Enlarged product image"><button type="button" className={styles.button} onClick={() => zoom.current?.close()}>Close image</button>{image ? <Image src={image.url} alt={image.altText || product.title} width={image.width} height={image.height} unoptimized /> : null}</dialog>
      </section>
      <section className={styles.productCopy}>
        <p className={styles.eyebrow}>{categoryName}</p><h1>{product.title}</h1>
        {preview ? <p className={styles.badge}>{product.status}</p> : null}
        {isStandOnly(product.title, categoryName) ? <p className={styles.standNotice}>Stand Only — No Printed Banner Included</p> : null}
        <p>{product.shortDescription}</p>
        <p className={styles.price}>{money(price)}</p><p className={styles.muted}>NZD, including 15% GST</p>
        {selection.salePriceCents !== null ? <p className={styles.muted}>Regular price <del>{money(selection.priceCents)}</del></p> : null}
        <p className={available ? styles.stock : styles.outOfStock}>{available ? "In stock" : "Out of stock"}</p>
        <p className={styles.muted}>SKU: {selection.sku}</p>
        {variants.length ? <label className={styles.field}>Specification<select aria-label="Specification" value={variantId} onChange={(event) => { setVariantId(event.target.value); setFeedback(""); }}>{variants.map((item) => <option key={item.id} value={item.id}>{item.label}{!item.active ? " (inactive)" : ""}</option>)}</select></label> : null}
        <label className={styles.field}>Quantity<input type="number" aria-label="Quantity" min={1} max={selection.trackInventory ? Math.min(999, selection.stockQuantity ?? 0) : 999} step={1} value={Number.isNaN(quantity) ? "" : quantity} onChange={(event) => { setQuantity(Number(event.target.value)); setFeedback(""); }} /></label>
        {!quantityAvailable && !preview ? <p role="alert">The selected quantity exceeds available stock.</p> : null}
        <button type="button" className={styles.button} disabled={!canAdd} onClick={addToCart}>{preview ? "Preview Add to Cart" : "Add to Cart"}</button>
        {feedback ? <p role="status" className={styles.feedback}>{feedback}{!preview && feedback.startsWith("Added") ? <> <Link href="/cart">View Cart</Link></> : null}</p> : null}
        <div className={styles.delivery}><h2>Pickup &amp; Shipping</h2>
          <p>{product.pickupAllowed ? "Pickup available in New Zealand." : "Pickup is unavailable for this item."}</p>
          <p>{product.shippingAllowed ? "New Zealand delivery rates are calculated at checkout using the package weight, dimensions and address." : "This item is available for pickup only."}</p>
        </div>
      </section>
    </div>
    <section className={styles.description}><h2>Product details</h2><p>{product.description || "Product details will be added soon."}</p></section>
  </Container>;
}
