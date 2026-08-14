"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProductRegistryPricing } from "@/domain/catalogue/product-registry";
import { createClientId } from "@/lib/client-id";
import type { listAdminProducts } from "@/server/admin/product-admin-service";
import styles from "./admin.module.css";

type AdminProduct = ReturnType<typeof listAdminProducts>[number];

function nzd(cents: number | undefined) {
  return cents === undefined ? "" : (cents / 100).toFixed(2);
}

function cents(value: FormDataEntryValue | null, optional = false) {
  const raw = String(value ?? "").trim();
  if (optional && raw === "") return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new Error("Enter each NZD amount with no more than two decimal places.");
  }
  const result = Math.round(Number(raw) * 100);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error("Enter a valid non-negative NZD amount.");
  }
  return result;
}

async function readResponse(response: Response) {
  const body = await response.json().catch(() => null) as {
    error?: string;
    result?: string;
    revision?: number;
  } | null;
  if (!response.ok || !body || !Number.isInteger(body.revision)) {
    throw new Error(body?.error || "Prices could not be published.");
  }
  return body as { result: string; revision: number };
}

export function ProductRegistryForm({ products, pricing, revision: initialRevision }: Readonly<{
  products: readonly AdminProduct[];
  pricing: ProductRegistryPricing;
  revision: number;
}>) {
  const router = useRouter();
  const [revision, setRevision] = useState(initialRevision);
  const [pending, setPending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, string>>({});

  async function publishProduct(
    event: FormEvent<HTMLFormElement>,
    product: AdminProduct,
  ) {
    event.preventDefault();
    if (!window.confirm(
      `Publish ${product.title} changes to the storefront and checkout now?`,
    )) return;
    const key = product.key;
    setPending(key);
    setFeedback((current) => ({ ...current, [key]: "" }));
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch(`/api/admin/products/${encodeURIComponent(key)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: revision,
          idempotencyKey: createClientId(),
          title: String(form.get("title") ?? ""),
          summary: String(form.get("summary") ?? ""),
          imageSrc: String(form.get("imageSrc") ?? ""),
          imageAlt: String(form.get("imageAlt") ?? ""),
          active: form.get("active") === "on",
          featured: form.get("featured") === "on",
          sizes: product.sizes.map((size) => ({
            key: size.key,
            label: String(form.get(`size-${size.key}-label`) ?? ""),
            priceExGstCents: cents(form.get(`size-${size.key}-price`)),
          })),
          includedPhotos: Number(form.get("includedPhotos")),
          extraPhotoPriceExGstCents: cents(form.get("extraPhotoPrice"), true),
          extraBackgroundRemovalFeeInclGstCents: cents(
            form.get("backgroundRemovalFee"),
            true,
          ),
        }),
      });
      const result = await readResponse(response);
      setRevision(result.revision);
      setFeedback((current) => ({
        ...current,
        [key]: `Published as registry revision ${result.revision}.`,
      }));
      router.refresh();
    } catch (error) {
      setFeedback((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : "Prices could not be published.",
      }));
    } finally {
      setPending(null);
    }
  }

  async function publishPricing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm(
      "Publish store-wide people, pets and urgent-service fees now?",
    )) return;
    const key = "pricing";
    setPending(key);
    setFeedback((current) => ({ ...current, [key]: "" }));
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/admin/products/pricing-policy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: revision,
          idempotencyKey: createClientId(),
          peoplePetsFeesExGstCents: [1, 2, 3, 4, 5].map((quantity) =>
            cents(form.get(`peoplePets-${quantity}`)),
          ),
          additionalPeoplePetsEachExGstCents: cents(
            form.get("additionalPeoplePetsEach"),
          ),
          urgentServiceFeesInclGstCents: [1, 2, 3, 4].map((workingDays) =>
            cents(form.get(`urgent-${workingDays}`)),
          ),
        }),
      });
      const result = await readResponse(response);
      setRevision(result.revision);
      setFeedback((current) => ({
        ...current,
        [key]: `Published as registry revision ${result.revision}.`,
      }));
      router.refresh();
    } catch (error) {
      setFeedback((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : "Prices could not be published.",
      }));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className={styles.registryEditor}>
      <section className={styles.formPanel}>
        <div className={styles.formSectionHeading}>
          <div><span>$</span><h2>Store-wide fees</h2></div>
          <p>People and pet prices exclude GST. Urgent-service fees include GST.</p>
        </div>
        <form onSubmit={publishPricing}>
          <div className={styles.formGrid}>
            {pricing.peoplePetsFeesExGstCents.map((amount, index) => (
              <label key={index + 1}>
                <span>{index + 1} people / pets fee ex GST (NZD)</span>
                <input name={`peoplePets-${index + 1}`} inputMode="decimal" defaultValue={nzd(amount)} required disabled={pending !== null} />
              </label>
            ))}
            <label>
              <span>Each person / pet from 6 onward ex GST (NZD)</span>
              <input name="additionalPeoplePetsEach" inputMode="decimal" defaultValue={nzd(pricing.additionalPeoplePetsEachExGstCents)} required disabled={pending !== null} />
            </label>
            {pricing.urgentServiceFeesInclGstCents.map((amount, index) => (
              <label key={index + 1}>
                <span>Working day {index + 1} urgent fee incl GST (NZD)</span>
                <input name={`urgent-${index + 1}`} inputMode="decimal" defaultValue={nzd(amount)} required disabled={pending !== null} />
              </label>
            ))}
          </div>
          <div className={styles.registryFormActions}>
            <p aria-live="polite">{feedback.pricing}</p>
            <button type="submit" disabled={pending !== null}>Publish store-wide fees</button>
          </div>
        </form>
      </section>

      <div className={styles.productAdminGrid}>
        {products.map((product) => (
          <form
            className={styles.productAdminCard}
            key={product.key}
            onSubmit={(event) => void publishProduct(event, product)}
          >
            <header>
              <div>
                <span>{product.category}</span>
                <h2>{product.title}</h2>
                <code>{product.slug} · {product.key}</code>
              </div>
              <div className={styles.productFlags}>
                <span>Revision {revision}</span>
              </div>
            </header>
            <div className={`${styles.formGrid} ${styles.registryProductFields}`}>
              <label><span>Product title</span><input name="title" defaultValue={product.title} maxLength={190} required disabled={pending !== null} /></label>
              <label className={styles.checkboxField}><input name="active" type="checkbox" defaultChecked={product.active} disabled={pending !== null} /><span>Published</span></label>
              <label className={styles.checkboxField}><input name="featured" type="checkbox" defaultChecked={product.featured} disabled={pending !== null} /><span>Featured</span></label>
              <label className={styles.fullField}><span>Product summary</span><textarea name="summary" defaultValue={product.summary} rows={3} maxLength={800} required disabled={pending !== null} /></label>
              <label className={styles.fullField}><span>Product image path</span><input name="imageSrc" defaultValue={product.image.src} maxLength={500} required disabled={pending !== null} /></label>
              <label className={styles.fullField}><span>Product image alternative text</span><input name="imageAlt" defaultValue={product.image.alt} minLength={10} maxLength={500} required disabled={pending !== null} /></label>
              {product.sizes.map((size) => (
                <div className={styles.registrySizeRow} key={size.key}>
                  <label><span>{size.key} display label</span><input name={`size-${size.key}-label`} defaultValue={size.label} maxLength={120} required disabled={pending !== null} /></label>
                  <label><span>{size.key} price ex GST (NZD)</span><input name={`size-${size.key}-price`} inputMode="decimal" defaultValue={nzd(size.priceExGstCents)} required disabled={pending !== null} /></label>
                </div>
              ))}
              <label><span>Included photos</span><input name="includedPhotos" type="number" min={0} max={20} defaultValue={product.includedPhotos} required disabled={pending !== null} /></label>
              <label><span>Extra photo ex GST (NZD, optional)</span><input name="extraPhotoPrice" inputMode="decimal" defaultValue={nzd(product.extraPhotoPriceExGstCents)} disabled={pending !== null} /></label>
              <label><span>Background removal incl GST (NZD, optional)</span><input name="backgroundRemovalFee" inputMode="decimal" defaultValue={nzd(product.extraBackgroundRemovalFeeInclGstCents)} disabled={pending !== null} /></label>
            </div>
            <div className={styles.registryFormActions}>
              <p aria-live="polite">{feedback[product.key]}</p>
              <button type="submit" disabled={pending !== null}>Publish {product.title}</button>
            </div>
          </form>
        ))}
      </div>
    </div>
  );
}
