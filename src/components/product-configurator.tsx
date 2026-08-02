"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Product } from "@/domain/catalogue/types";
import { createBrowserCartRepository } from "@/domain/cart/browser-cart-repository";
import { addCartItem } from "@/domain/cart/cart";
import type {
  DeliveryPreference,
  Orientation,
  PhotoSubmissionMethod,
  ProductConfigurationSchema,
} from "@/domain/configuration/types";
import { quoteConfiguration } from "@/domain/configuration/quote";
import { formatNzd } from "@/domain/money";
import styles from "./storefront.module.css";

type ProductConfiguratorProps = Readonly<{
  product: Product;
  schema: ProductConfigurationSchema;
  createId?: () => string;
}>;

function defaultNeededDate(): string {
  const date = new Date();
  let remaining = 5;
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    if (date.getDay() !== 0 && date.getDay() !== 6) remaining -= 1;
  }
  return date.toISOString().slice(0, 10);
}

export function ProductConfigurator({
  product,
  schema,
  createId = () => crypto.randomUUID(),
}: ProductConfiguratorProps) {
  const [sizeKey, setSizeKey] = useState(schema.defaultSizeKey);
  const [orientation, setOrientation] = useState<Orientation | undefined>(
    schema.defaultOrientation,
  );
  const [peoplePets, setPeoplePets] = useState(schema.defaultPeoplePets);
  const [photoSubmissionMethod, setPhotoSubmissionMethod] =
    useState<PhotoSubmissionMethod>(schema.defaultPhotoSubmissionMethod);
  const [designText, setDesignText] = useState("");
  const [notes, setNotes] = useState("");
  const [neededDate, setNeededDate] = useState(defaultNeededDate);
  const [deliveryPreference, setDeliveryPreference] =
    useState<DeliveryPreference>(schema.defaultDeliveryPreference);
  const [added, setAdded] = useState(false);

  const size = schema.sizes.find((option) => option.key === sizeKey)!;
  const quote = useMemo(
    () => quoteConfiguration(schema, { sizeKey, peoplePets }),
    [peoplePets, schema, sizeKey],
  );

  function addToCart() {
    const repository = createBrowserCartRepository(window.localStorage);
    const cart = addCartItem(repository.load(), {
      id: createId(),
      productKey: product.key,
      productSlug: product.slug,
      productTitle: product.title,
      imageSrc: product.image.src,
      sizeKey,
      sizeLabel: size.label,
      orientation,
      peoplePets,
      photoSubmissionMethod,
      designText,
      notes,
      neededDate,
      deliveryPreference,
      quantity: 1,
      price: quote,
      uploadReferences: [],
    });
    repository.save(cart);
    setAdded(true);
  }

  return (
    <div className={styles.configuratorLayout}>
      <form
        className={styles.configuratorForm}
        onSubmit={(event) => {
          event.preventDefault();
          addToCart();
        }}
      >
        <section className={styles.configuratorStep}>
          <div className={styles.stepHeading}>
            <span>01</span>
            <div>
              <h2>Choose the format</h2>
              <p>Select the finished size and orientation.</p>
            </div>
          </div>

          <div className={styles.fieldGrid}>
            <label className={styles.formField}>
              <span>Size</span>
              <select value={sizeKey} onChange={(event) => setSizeKey(event.target.value)}>
                {schema.sizes.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            </label>

            {schema.orientationMode === "choice" && (
              <fieldset className={styles.formField}>
                <legend>Orientation</legend>
                <div className={styles.segmentedControl}>
                  {(["landscape", "portrait"] as const).map((option) => (
                    <label key={option}>
                      <input
                        type="radio"
                        name="orientation"
                        value={option}
                        checked={orientation === option}
                        onChange={() => setOrientation(option)}
                        aria-label={option === "landscape" ? "Landscape" : "Portrait"}
                      />
                      <span>{option === "landscape" ? "Landscape" : "Portrait"}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </div>
        </section>

        {schema.peoplePetsMode === "required" && (
          <section className={styles.configuratorStep}>
            <div className={styles.stepHeading}>
              <span>02</span>
              <div>
                <h2>People or pets</h2>
                <p>Price is based on the number included in the final artwork.</p>
              </div>
            </div>
            <div className={styles.counterRow}>
              <label htmlFor="people-pets">People or pets in artwork</label>
              <div className={styles.counter}>
                <button
                  type="button"
                  aria-label="Decrease people or pets"
                  onClick={() => setPeoplePets((value) => Math.max(1, value - 1))}
                >−</button>
                <input id="people-pets" value={peoplePets} readOnly inputMode="numeric" />
                <button
                  type="button"
                  aria-label="Increase people or pets"
                  onClick={() => setPeoplePets((value) => value + 1)}
                >+</button>
              </div>
            </div>
          </section>
        )}

        <section className={styles.configuratorStep}>
          <div className={styles.stepHeading}>
            <span>{schema.peoplePetsMode === "required" ? "03" : "02"}</span>
            <div>
              <h2>Source photos</h2>
              <p>Choose how you will provide the clearest original files.</p>
            </div>
          </div>
          <fieldset className={styles.choiceCards}>
            <legend>Photo submission</legend>
            <label>
              <input
                type="radio"
                name="photo-submission"
                checked={photoSubmissionMethod === "upload"}
                onChange={() => setPhotoSubmissionMethod("upload")}
              />
              <span><strong>Upload on this page</strong><small>Attach private source files before adding to cart.</small></span>
            </label>
            <label>
              <input
                type="radio"
                name="photo-submission"
                checked={photoSubmissionMethod === "later"}
                onChange={() => setPhotoSubmissionMethod("later")}
              />
              <span><strong>Send after ordering</strong><small>Provide files later by Messenger, email or WhatsApp.</small></span>
            </label>
          </fieldset>
        </section>

        <section className={styles.configuratorStep}>
          <div className={styles.stepHeading}>
            <span>{schema.peoplePetsMode === "required" ? "04" : "03"}</span>
            <div>
              <h2>Artwork direction</h2>
              <p>Add wording, photo order, colours and the feeling you want.</p>
            </div>
          </div>
          <label className={styles.formField}>
            <span>Text for your design</span>
            <textarea value={designText} onChange={(event) => setDesignText(event.target.value)} />
          </label>
          <label className={styles.formField}>
            <span>Design notes</span>
            <textarea
              value={notes}
              placeholder="Theme, occasion, colours, photo order…"
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
        </section>

        <section className={styles.configuratorStep}>
          <div className={styles.stepHeading}>
            <span>{schema.peoplePetsMode === "required" ? "05" : "04"}</span>
            <div>
              <h2>Timing and delivery</h2>
              <p>Tell us when you need it and how you prefer to receive it.</p>
            </div>
          </div>
          <div className={styles.fieldGrid}>
            <label className={styles.formField}>
              <span>Needed by</span>
              <input
                type="date"
                required
                value={neededDate}
                onChange={(event) => setNeededDate(event.target.value)}
              />
            </label>
            <label className={styles.formField}>
              <span>Delivery</span>
              <select
                value={deliveryPreference}
                onChange={(event) => setDeliveryPreference(event.target.value as DeliveryPreference)}
              >
                <option value="post">Post</option>
                <option value="pickup">Pickup</option>
              </select>
            </label>
          </div>
        </section>

        <button className={styles.mobileAddButton} type="submit">Add to cart</button>
      </form>

      <aside className={styles.priceSummary} aria-label="Order summary">
        <p className={styles.eyebrow}>Estimated price</p>
        <h2>Order summary</h2>
        <p>{product.title}</p>
        <dl className={styles.summaryDetails}>
          <div><dt>Size</dt><dd>{size.label}</dd></div>
          {orientation && <div><dt>Orientation</dt><dd>{orientation === "landscape" ? "Landscape" : "Portrait"}</dd></div>}
          {schema.peoplePetsMode === "required" && <div><dt>People / pets</dt><dd>{peoplePets}</dd></div>}
        </dl>
        <dl className={styles.priceLines}>
          {quote.lines.map((line) => (
            <div key={line.key}><dt>{line.label}</dt><dd>{formatNzd(line.amountExGstCents)}</dd></div>
          ))}
          <div><dt>Subtotal ex GST</dt><dd>{formatNzd(quote.subtotalExGstCents)}</dd></div>
          <div><dt>GST (15%)</dt><dd>{formatNzd(quote.gstCents)}</dd></div>
          <div className={styles.priceTotal}><dt>Total incl GST</dt><dd>{formatNzd(quote.totalInclGstCents)}</dd></div>
        </dl>
        <button className={styles.primaryButton} type="button" onClick={addToCart}>Add to cart</button>
        {added && (
          <p className={styles.addedMessage} role="status">
            Added to your cart. <Link href="/cart">View cart</Link>
          </p>
        )}
      </aside>
    </div>
  );
}
