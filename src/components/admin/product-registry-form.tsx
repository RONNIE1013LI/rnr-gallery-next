"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ProductRegistryDocument,
  ProductRegistryPricing,
} from "@/domain/catalogue/product-registry";
import { createClientId } from "@/lib/client-id";
import type { listAdminProducts } from "@/server/admin/product-admin-service";
import styles from "./admin.module.css";

type AdminProduct = ReturnType<typeof listAdminProducts>[number];

function moneyInput(cents: number | null | undefined) {
  return cents === undefined || cents === null ? "" : (cents / 100).toFixed(2);
}

function cents(
  value: FormDataEntryValue | null,
  optional = false,
  currency = "NZD",
) {
  const raw = String(value ?? "").trim();
  if (optional && raw === "") return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new Error(`Enter each ${currency} amount with no more than two decimal places.`);
  }
  const result = Math.round(Number(raw) * 100);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`Enter a valid non-negative ${currency} amount.`);
  }
  return result;
}

function taxRateBasisPoints(value: FormDataEntryValue | null) {
  const result = cents(value, false, "tax rate");
  if (result === null || result > 10_000) {
    throw new Error("Enter an Australian GST rate between 0 and 100 percent.");
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

export function ProductRegistryForm({
  products,
  pricing,
  markets,
  australiaCompleteness,
  revision: initialRevision,
}: Readonly<{
  products: readonly AdminProduct[];
  pricing: ProductRegistryPricing;
  markets: ProductRegistryDocument["markets"];
  australiaCompleteness: Readonly<{
    ready: boolean;
    missingKeys: readonly string[];
  }>;
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
          sizes: product.sizes.map((size) => {
            const label = String(form.get(`size-${size.key}-label`) ?? "");
            if (size.nzAmountInclTaxCents !== undefined) {
              const nzAmountInclTaxCents = cents(
                form.get(`size-${size.key}-final-price`),
              );
              if (nzAmountInclTaxCents === null) throw new Error("Enter a valid NZD amount.");
              return {
                key: size.key,
                label,
                priceExGstCents: Math.round((nzAmountInclTaxCents * 100) / 115),
                nzAmountInclTaxCents,
              };
            }
            return {
              key: size.key,
              label,
              priceExGstCents: cents(form.get(`size-${size.key}-price`)),
            };
          }),
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

  async function publishAustralia(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm("Save the fixed Australia AUD price book now?")) return;
    const key = "AU";
    setPending(key);
    setFeedback((current) => ({ ...current, [key]: "" }));
    try {
      const form = new FormData(event.currentTarget);
      const priceBook = {
        ...markets.AU,
        enabled: australiaCompleteness.ready && form.get("au-enabled") === "on",
        tax: {
          registered: form.get("au-gst-registered") === "on",
          rateBasisPoints: taxRateBasisPoints(form.get("au-gst-rate")),
        },
        products: markets.AU.products.map((product) => ({
          ...product,
          sizes: product.sizes.map((size) => ({
            ...size,
            amountInclTaxCents: cents(
              form.get(`au-product-${product.productKey}-size-${size.sizeKey}`),
              true,
              "AUD",
            ),
          })),
          charges: product.charges.map((charge) => ({
            ...charge,
            amountInclTaxCents: cents(
              form.get(`au-product-${product.productKey}-charge-${charge.key}`),
              true,
              "AUD",
            ),
          })),
        })),
        peoplePets: {
          fees: markets.AU.peoplePets.fees.map((fee) => ({
            ...fee,
            amountInclTaxCents: cents(
              form.get(`au-people-pets-${fee.count}`),
              true,
              "AUD",
            ),
          })),
          additionalEachInclTaxCents: cents(
            form.get("au-people-pets-additional"),
            true,
            "AUD",
          ),
        },
        urgentServiceFees: markets.AU.urgentServiceFees.map((fee) => ({
          ...fee,
          amountInclTaxCents: cents(
            form.get(`au-urgent-${fee.workingDays}`),
            true,
            "AUD",
          ),
        })),
        shippingMethods: markets.AU.shippingMethods.map((method) => ({
          ...method,
          label: String(form.get(`au-shipping-${method.key}-label`) ?? ""),
          active: form.get(`au-shipping-${method.key}-active`) === "on",
          amountInclTaxCents: cents(
            form.get(`au-shipping-${method.key}-amount`),
            true,
            "AUD",
          ),
        })),
      };
      const response = await fetch("/api/admin/products/market-pricing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: revision,
          idempotencyKey: createClientId(),
          priceBook,
        }),
      });
      const result = await readResponse(response);
      setRevision(result.revision);
      setFeedback((current) => ({
        ...current,
        [key]: `Saved as registry revision ${result.revision}.`,
      }));
      router.refresh();
    } catch (error) {
      setFeedback((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : "Australia prices could not be saved.",
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
                <input name={`peoplePets-${index + 1}`} inputMode="decimal" defaultValue={moneyInput(amount)} required disabled={pending !== null} />
              </label>
            ))}
            <label>
              <span>Each person / pet from 6 onward ex GST (NZD)</span>
              <input name="additionalPeoplePetsEach" inputMode="decimal" defaultValue={moneyInput(pricing.additionalPeoplePetsEachExGstCents)} required disabled={pending !== null} />
            </label>
            {pricing.urgentServiceFeesInclGstCents.map((amount, index) => (
              <label key={index + 1}>
                <span>Working day {index + 1} urgent fee incl GST (NZD)</span>
                <input name={`urgent-${index + 1}`} inputMode="decimal" defaultValue={moneyInput(amount)} required disabled={pending !== null} />
              </label>
            ))}
          </div>
          <div className={styles.registryFormActions}>
            <p aria-live="polite">{feedback.pricing}</p>
            <button type="submit" disabled={pending !== null}>Publish store-wide fees</button>
          </div>
        </form>
      </section>

      <section className={styles.formPanel}>
        <div className={styles.formSectionHeading}>
          <div><span>A$</span><h2>Australia — AUD</h2></div>
          <p>Fixed final AUD prices. No NZD conversion is performed. Australia remains unavailable until every required value is present.</p>
        </div>
        <p role="status">
          {australiaCompleteness.ready
            ? "Australia price book is complete and can be enabled after operational approval."
            : `${australiaCompleteness.missingKeys.length} AUD prices still required.`}
        </p>
        <form onSubmit={(event) => void publishAustralia(event)}>
          <div className={styles.formGrid}>
            <label className={styles.checkboxField}>
              <input
                name="au-enabled"
                type="checkbox"
                defaultChecked={markets.AU.enabled}
                disabled={pending !== null || !australiaCompleteness.ready}
              />
              <span>Enable Australia checkout</span>
            </label>
            <label className={styles.checkboxField}>
              <input name="au-gst-registered" type="checkbox" defaultChecked={markets.AU.tax.registered} disabled={pending !== null} />
              <span>Registered for Australian GST</span>
            </label>
            <label>
              <span>Australian GST rate (%)</span>
              <input name="au-gst-rate" inputMode="decimal" defaultValue={(markets.AU.tax.rateBasisPoints / 100).toFixed(2)} required disabled={pending !== null} />
            </label>
          </div>

          {markets.AU.products.map((marketProduct) => {
            const product = products.find((candidate) => candidate.key === marketProduct.productKey);
            const title = product?.title ?? marketProduct.productKey;
            return (
              <fieldset key={marketProduct.productKey} className={styles.formPanel}>
                <legend>{title}</legend>
                <div className={styles.formGrid}>
                  {marketProduct.sizes.map((size) => (
                    <label key={size.sizeKey}>
                      <span>{title} · {size.sizeKey} final price (AUD)</span>
                      <input name={`au-product-${marketProduct.productKey}-size-${size.sizeKey}`} inputMode="decimal" defaultValue={moneyInput(size.amountInclTaxCents)} disabled={pending !== null} />
                    </label>
                  ))}
                  {marketProduct.charges.map((charge) => (
                    <label key={charge.key}>
                      <span>{title} · {charge.key} final price (AUD)</span>
                      <input name={`au-product-${marketProduct.productKey}-charge-${charge.key}`} inputMode="decimal" defaultValue={moneyInput(charge.amountInclTaxCents)} disabled={pending !== null} />
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}

          <fieldset className={styles.formPanel}>
            <legend>People, pets and urgent service</legend>
            <div className={styles.formGrid}>
              {markets.AU.peoplePets.fees.map((fee) => (
                <label key={fee.count}>
                  <span>{fee.count} people / pets final price (AUD)</span>
                  <input name={`au-people-pets-${fee.count}`} inputMode="decimal" defaultValue={moneyInput(fee.amountInclTaxCents)} disabled={pending !== null} />
                </label>
              ))}
              <label>
                <span>Each person / pet from 6 onward final price (AUD)</span>
                <input name="au-people-pets-additional" inputMode="decimal" defaultValue={moneyInput(markets.AU.peoplePets.additionalEachInclTaxCents)} disabled={pending !== null} />
              </label>
              {markets.AU.urgentServiceFees.map((fee) => (
                <label key={fee.workingDays}>
                  <span>Working day {fee.workingDays} urgent fee final price (AUD)</span>
                  <input name={`au-urgent-${fee.workingDays}`} inputMode="decimal" defaultValue={moneyInput(fee.amountInclTaxCents)} disabled={pending !== null} />
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className={styles.formPanel}>
            <legend>Australia shipping</legend>
            <div className={styles.formGrid}>
              {markets.AU.shippingMethods.map((method) => (
                <div key={method.key} className={styles.registrySizeRow}>
                  <label><span>{method.key} label</span><input name={`au-shipping-${method.key}-label`} defaultValue={method.label} required disabled={pending !== null} /></label>
                  <label><span>{method.key} final price (AUD)</span><input name={`au-shipping-${method.key}-amount`} inputMode="decimal" defaultValue={moneyInput(method.amountInclTaxCents)} disabled={pending !== null} /></label>
                  <label className={styles.checkboxField}><input name={`au-shipping-${method.key}-active`} type="checkbox" defaultChecked={method.active} disabled={pending !== null} /><span>Active</span></label>
                </div>
              ))}
            </div>
          </fieldset>

          <div className={styles.registryFormActions}>
            <p aria-live="polite">{feedback.AU}</p>
            <button type="submit" disabled={pending !== null}>Save Australia price book</button>
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
                  {size.nzAmountInclTaxCents !== undefined ? (
                    <label><span>{size.key} final price incl GST (NZD)</span><input name={`size-${size.key}-final-price`} inputMode="decimal" defaultValue={moneyInput(size.nzAmountInclTaxCents)} required disabled={pending !== null} /></label>
                  ) : (
                    <label><span>{size.key} price ex GST (NZD)</span><input name={`size-${size.key}-price`} inputMode="decimal" defaultValue={moneyInput(size.priceExGstCents)} required disabled={pending !== null} /></label>
                  )}
                </div>
              ))}
              <label><span>Included photos</span><input name="includedPhotos" type="number" min={0} max={20} defaultValue={product.includedPhotos} required disabled={pending !== null} /></label>
              <label><span>Extra photo ex GST (NZD, optional)</span><input name="extraPhotoPrice" inputMode="decimal" defaultValue={moneyInput(product.extraPhotoPriceExGstCents)} disabled={pending !== null} /></label>
              <label><span>Background removal incl GST (NZD, optional)</span><input name="backgroundRemovalFee" inputMode="decimal" defaultValue={moneyInput(product.extraBackgroundRemovalFeeInclGstCents)} disabled={pending !== null} /></label>
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
