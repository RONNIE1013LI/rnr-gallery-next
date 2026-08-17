"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import type { Product } from "@/domain/catalogue/types";
import {
  defaultProductRegistry,
  type ProductRegistryDocument,
  type ProductRegistryPricing,
} from "@/domain/catalogue/product-registry";
import { createBrowserCartRepository } from "@/domain/cart/browser-cart-repository";
import { notifyCartChanged } from "@/domain/cart/browser-cart-events";
import { addCartItem, setCartDeliveryPreference } from "@/domain/cart/cart";
import type { CartItem } from "@/domain/cart/types";
import { emitAnalyticsEvent } from "@/domain/analytics/client";
import { buildCartItemEvent } from "@/domain/analytics/events";
import type {
  DeliveryPreference,
  Orientation,
  ProductConfigurationSchema,
} from "@/domain/configuration/types";
import { quoteConfiguration } from "@/domain/configuration/quote";
import { formatConfigurationSizeLabel } from "@/domain/configuration/size-label";
import { addNzdGst, formatMarketMoney } from "@/domain/money";
import { currencyForMarket } from "@/domain/markets/market";
import type { Market } from "@/domain/markets/types";
import { quoteMarketConfiguration } from "@/domain/pricing/market-quote";
import { getPriceLineAmountInclGstCents } from "@/domain/pricing/types";
import { MAX_PEOPLE_PETS_PER_ITEM } from "@/domain/checkout/input-schema";
import { createClientId } from "@/lib/client-id";
import {
  addWorkingDays,
  getUrgentService,
} from "@/domain/scheduling/urgent-service";
import styles from "./storefront.module.css";
import { useContainedDialog } from "./forms/use-contained-dialog";
import type { GalleryDesignSelection } from "@/server/gallery/design-selection-service";
import { PurchaseTrustStrip } from "./purchase-trust-strip";
import {
  SourcePhotoCustomisation,
  type SourcePhotoCustomisationValue,
} from "./source-photo-customisation";

export type ProductConfiguratorRelatedDesign = Readonly<{
  id: string;
  title: string;
  altText: string;
  imageUrl: string;
  width: number;
  height: number;
  productSlug: string;
}>;

export type ProductConfiguratorProps = Readonly<{
  product: Product;
  schema: ProductConfigurationSchema;
  pricing?: ProductRegistryPricing;
  registry?: ProductRegistryDocument;
  market?: Market;
  orderDate: string;
  createId?: () => string;
  selectedDesign?: GalleryDesignSelection | null;
  relatedDesigns?: readonly ProductConfiguratorRelatedDesign[];
  initialSizeKey?: string;
}>;

export function ProductConfigurator({
  product,
  schema,
  pricing = defaultProductRegistry.pricing,
  registry,
  market = "NZ",
  orderDate,
  createId = createClientId,
  selectedDesign = null,
  relatedDesigns = [],
  initialSizeKey,
}: ProductConfiguratorProps) {
  const designInspiration = selectedDesign;
  const [sizeKey, setSizeKey] = useState(
    initialSizeKey && schema.sizes.some((size) => size.key === initialSizeKey)
      ? initialSizeKey
      : schema.defaultSizeKey,
  );
  const [orientation, setOrientation] = useState<Orientation | undefined>(
    schema.defaultOrientation,
  );
  const [peoplePets, setPeoplePets] = useState(schema.defaultPeoplePets);
  const [sourcePhotoCustomisation, setSourcePhotoCustomisation] =
    useState<SourcePhotoCustomisationValue>({
      photoSubmissionMethod: schema.defaultPhotoSubmissionMethod,
      designText: "",
      notes: "",
      uploadedFiles: [],
      extraBackgroundRemovalUploadIds: [],
    });
  const [neededDate, setNeededDate] = useState(() => addWorkingDays(orderDate, 5));
  const [urgentServiceConfirmed, setUrgentServiceConfirmed] = useState(false);
  const [deliveryPreference, setDeliveryPreference] =
    useState<DeliveryPreference>(schema.defaultDeliveryPreference);
  const [uploading, setUploading] = useState(false);
  const [added, setAdded] = useState(false);
  const [isPreviewZoomOpen, setIsPreviewZoomOpen] = useState(false);
  const previewZoomTriggerRef = useRef<HTMLButtonElement>(null);
  const previewZoomDialogRef = useRef<HTMLDivElement>(null);
  const previewZoomCloseRef = useRef<HTMLButtonElement>(null);
  const closePreviewZoom = useCallback(() => setIsPreviewZoomOpen(false), []);
  const {
    photoSubmissionMethod,
    designText,
    notes,
    uploadedFiles,
    mainPhotoUploadId,
    extraBackgroundRemovalUploadIds,
  } = sourcePhotoCustomisation;

  useContainedDialog({
    active: isPreviewZoomOpen,
    dialogRef: previewZoomDialogRef,
    initialFocusRef: previewZoomCloseRef,
    isolationRootRef: previewZoomDialogRef,
    returnFocusRef: previewZoomTriggerRef,
    onClose: closePreviewZoom,
  });

  const size = schema.sizes.find((option) => option.key === sizeKey)!;
  const sizeLabel = formatConfigurationSizeLabel(size, orientation);
  const showFormatStep =
    schema.sizes.length > 1 || schema.orientationMode === "choice";
  const formatStepNumber = showFormatStep ? 1 : 0;
  const peopleStepNumber = formatStepNumber + 1;
  const sourceStepNumber = peopleStepNumber + (schema.peoplePetsMode === "required" ? 1 : 0);
  const showArtworkDirection = schema.artworkDirectionMode !== "none";
  const artworkStepNumber = sourceStepNumber + 1;
  const timingStepNumber = artworkStepNumber + (showArtworkDirection ? 1 : 0);
  const supportsBackgroundRemoval =
    schema.extraBackgroundRemovalFeeInclGstCents !== undefined;
  const uploadReferences =
    photoSubmissionMethod === "upload" ? uploadedFiles.map((file) => file.id) : [];
  const activeBackgroundRemovalUploadIds =
    photoSubmissionMethod === "upload" ? extraBackgroundRemovalUploadIds : [];
  const previewImage = designInspiration?.imageUrl ?? product.image.src;
  const previewAlt = designInspiration?.altText ?? product.image.alt;
  const currency = currencyForMarket(market);
  const marketBook = registry?.markets[market];
  const taxRegistered = market === "NZ" || marketBook?.tax.registered === true;
  const taxSuffix = taxRegistered ? " incl GST" : "";
  const backgroundRemovalFeeInclTaxCents =
    marketBook?.products
      .find((entry) => entry.productKey === product.key)
      ?.charges.find((charge) => charge.key === "background-removal")
      ?.amountInclTaxCents ?? schema.extraBackgroundRemovalFeeInclGstCents;
  const urgentFees = useMemo(
    () => marketBook
      ? marketBook.urgentServiceFees.map((fee) => fee.amountInclTaxCents ?? 0)
      : pricing.urgentServiceFeesInclGstCents,
    [marketBook, pricing.urgentServiceFeesInclGstCents],
  );
  const urgentService = useMemo(() => {
    try {
      return getUrgentService(
        orderDate,
        neededDate,
        urgentFees,
      );
    } catch {
      return null;
    }
  }, [neededDate, orderDate, urgentFees]);
  const sizeChoices = useMemo(
    () => schema.sizes.map((option) => ({
      key: option.key,
      label: formatConfigurationSizeLabel(option, orientation),
      minimumPriceInclTaxCents: registry
        ? quoteMarketConfiguration(registry, market, product.key, {
            sizeKey: option.key,
            peoplePets: schema.defaultPeoplePets,
          }).totalInclGstCents
        : addNzdGst(quoteConfiguration(
            schema,
            {
              sizeKey: option.key,
              peoplePets: schema.defaultPeoplePets,
            },
            { peoplePetsPricing: pricing },
          ).subtotalExGstCents),
    })),
    [market, orientation, pricing, product.key, registry, schema],
  );
  const quote = useMemo(
    () => registry
      ? quoteMarketConfiguration(registry, market, product.key, {
          sizeKey,
          peoplePets,
          sourcePhotoCount: uploadReferences.length,
          extraBackgroundRemovalCount: activeBackgroundRemovalUploadIds.length,
          urgentWorkingDays: urgentServiceConfirmed && urgentService?.requiresConfirmation
            ? urgentService.workingDays
            : undefined,
        })
      : quoteConfiguration(
          schema,
          {
            sizeKey,
            peoplePets,
            sourcePhotoCount: uploadReferences.length,
            extraBackgroundRemovalCount: activeBackgroundRemovalUploadIds.length,
            urgentFeeInclGstCents: urgentServiceConfirmed
              ? urgentService?.feeInclGstCents
              : 0,
          },
          { peoplePetsPricing: pricing },
        ),
    [
      peoplePets,
      market,
      pricing,
      product.key,
      registry,
      activeBackgroundRemovalUploadIds.length,
      schema,
      sizeKey,
      uploadReferences.length,
      urgentService,
      urgentServiceConfirmed,
    ],
  );
  const uploadRequired =
    photoSubmissionMethod === "upload" &&
    uploadedFiles.length < schema.minimumSourcePhotos;
  const urgentConfirmationRequired = Boolean(
    urgentService?.requiresConfirmation && !urgentServiceConfirmed,
  );
  const addDisabled =
    uploading || uploadRequired || !urgentService || urgentConfirmationRequired;

  function addToCart() {
    if (addDisabled || !urgentService) return;
    const repository = createBrowserCartRepository(window.localStorage);
    const item: CartItem = {
      id: createId(),
      productKey: product.key,
      productSlug: product.slug,
      productTitle: product.title,
      imageSrc: product.image.src,
      ...(designInspiration ? { galleryDesignId: designInspiration.id } : {}),
      sizeKey,
      sizeLabel,
      orientation,
      peoplePets,
      photoSubmissionMethod,
      designText,
      notes,
      neededDate,
      urgentServiceConfirmed,
      urgentFeeInclGstCents: urgentService.feeInclGstCents,
      deliveryPreference,
      quantity: 1,
      price: quote,
      uploadReferences,
      ...(supportsBackgroundRemoval && photoSubmissionMethod === "upload" && mainPhotoUploadId
        ? { mainPhotoUploadId }
        : {}),
      ...(activeBackgroundRemovalUploadIds.length > 0
        ? { extraBackgroundRemovalUploadIds: activeBackgroundRemovalUploadIds }
        : {}),
    };
    const cart = setCartDeliveryPreference(
      addCartItem(repository.load(), item),
      deliveryPreference,
    );
    repository.save(cart);
    notifyCartChanged();
    setAdded(true);
    try {
      emitAnalyticsEvent(buildCartItemEvent("add_to_cart", item));
    } catch {
      // Analytics must never change a successfully persisted cart action.
    }
  }

  return (
    <>
      <div className={styles.configuratorLayout}>
        <div className={styles.configuratorSidebar}>
        <section className={styles.artworkPreview} aria-label="Artwork preview">
        <div className={styles.artworkPreviewMedia}>
          <Image
            src={previewImage}
            alt={previewAlt}
            fill
            priority
            sizes="(max-width: 820px) 100vw, 38vw"
          />
          <button
            ref={previewZoomTriggerRef}
            type="button"
            className={styles.previewZoom}
            aria-label="View full image"
            onClick={() => setIsPreviewZoomOpen(true)}
          >
            <span aria-hidden="true" role="img">🔍</span>
          </button>
        </div>
        <div className={styles.artworkPreviewCopy}>
          <p className={styles.eyebrow}>Example shown</p>
          <h2>{product.title}</h2>
          <p>Preview your selection as you personalise your order.</p>
          <dl className={styles.previewDetails}>
            <div><dt>Format</dt><dd>{sizeLabel}</dd></div>
            {orientation && <div><dt>Orientation</dt><dd>{orientation === "landscape" ? "Landscape" : "Portrait"}</dd></div>}
            {schema.peoplePetsMode === "required" && <div><dt>People / pets</dt><dd>{peoplePets}</dd></div>}
          </dl>
        </div>
        </section>

        {isPreviewZoomOpen ? (
          <div
            ref={previewZoomDialogRef}
            className={styles.imageZoomOverlay}
            role="dialog"
            aria-modal="true"
            aria-label="Artwork full image"
            onClick={closePreviewZoom}
            tabIndex={-1}
          >
            <div className={styles.imageZoomDialog} onClick={(event) => event.stopPropagation()}>
              <button
                ref={previewZoomCloseRef}
                type="button"
                className={styles.imageZoomClose}
                onClick={closePreviewZoom}
                aria-label="Close image preview"
              >
                ×
              </button>
              <div className={styles.imageZoomFrame}>
                {/* Object URL previews are local browser files and cannot use the Next image optimizer. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewImage}
                  alt={previewAlt}
                  className={styles.imageZoomImage}
                />
              </div>
            </div>
          </div>
        ) : null}

        <aside className={styles.priceSummary} aria-label="Order summary">
          <p className={styles.eyebrow}>Estimated price</p>
          <h2>Order summary</h2>
          <p>{product.title}</p>
          <dl className={styles.summaryDetails}>
            <div><dt>Size</dt><dd>{sizeLabel}</dd></div>
            {orientation && <div><dt>Orientation</dt><dd>{orientation === "landscape" ? "Landscape" : "Portrait"}</dd></div>}
            {schema.peoplePetsMode === "required" && <div><dt>People / pets</dt><dd>{peoplePets}</dd></div>}
          </dl>
          <dl className={styles.priceLines}>
            {quote.lines.map((line) => (
              <div key={line.key}>
                <dt>{line.label}</dt>
                <dd>
                  {formatMarketMoney(getPriceLineAmountInclGstCents(line), currency)}{taxSuffix}
                </dd>
              </div>
            ))}
            <div>
              <dt>{market === "NZ" ? "Includes GST (15%)" : taxRegistered ? "Includes Australian GST" : "Australian GST not charged"}</dt>
              <dd>{formatMarketMoney(quote.gstCents, currency)}</dd>
            </div>
            <div className={styles.priceTotal}>
              <dt>{taxRegistered ? "Total incl GST" : "Total"}</dt>
              <dd>{formatMarketMoney(quote.totalInclGstCents, currency)}</dd>
            </div>
          </dl>
          <PurchaseTrustStrip />
          <button
            className={styles.primaryButton}
            type="button"
            disabled={addDisabled}
            onClick={addToCart}
          >
            {uploadRequired
              ? "Upload a source photo to continue"
              : urgentConfirmationRequired
                ? "Confirm urgent service to continue"
                : "Add to cart"}
          </button>
          {added && (
            <p className={styles.addedMessage} role="status">
              <span>Added to your cart.</span>
              <Link className={styles.addedMessageAction} href="/cart">View cart</Link>
            </p>
          )}
        </aside>
      </div>

        <form
        id="customise"
        className={styles.configuratorForm}
        onSubmit={(event) => {
          event.preventDefault();
          addToCart();
        }}
      >
        {showFormatStep && (
        <section className={styles.configuratorStep}>
          <div className={styles.stepHeading}>
            <span>{String(formatStepNumber).padStart(2, "0")}</span>
            <div>
              <h2>Choose the format</h2>
              <p>{schema.orientationMode === "choice" ? "Dimensions are always shown as width × height." : "Select the finished size."}</p>
            </div>
          </div>

          <div className={styles.fieldGrid}>
            {schema.sizes.length > 1 && (
              <fieldset className={styles.sizePicker} role="radiogroup">
                <legend>Size</legend>
                <div className={styles.sizeOptions}>
                  {sizeChoices.map((option) => {
                    const priceLabel = `From ${formatMarketMoney(option.minimumPriceInclTaxCents, currency)}`;
                    return (
                      <label className={styles.sizeOption} key={option.key}>
                        <input
                          type="radio"
                          name="size"
                          value={option.key}
                          checked={sizeKey === option.key}
                          onChange={() => setSizeKey(option.key)}
                          aria-label={`${option.label}, ${priceLabel}`}
                        />
                        <span className={styles.sizeOptionBody}>
                          <strong>{option.label}</strong>
                          <span>{priceLabel}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}

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
        )}

        {schema.peoplePetsMode === "required" && (
          <section className={styles.configuratorStep}>
            <div className={styles.stepHeading}>
              <span>{String(peopleStepNumber).padStart(2, "0")}</span>
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
                <input id="people-pets" value={peoplePets} readOnly inputMode="numeric" max={MAX_PEOPLE_PETS_PER_ITEM} />
                <button
                  type="button"
                  aria-label="Increase people or pets"
                  disabled={peoplePets >= MAX_PEOPLE_PETS_PER_ITEM}
                  onClick={() => setPeoplePets((value) => Math.min(MAX_PEOPLE_PETS_PER_ITEM, value + 1))}
                >+</button>
              </div>
            </div>
          </section>
        )}

        <SourcePhotoCustomisation
          inputName="photo-submission"
          sourceStepNumber={sourceStepNumber}
          artworkStepNumber={artworkStepNumber}
          schema={schema}
          market={market}
          taxRegistered={taxRegistered}
          backgroundRemovalFeeInclTaxCents={backgroundRemovalFeeInclTaxCents}
          value={sourcePhotoCustomisation}
          onChange={setSourcePhotoCustomisation}
          onUploadingChange={setUploading}
        />

        <section className={styles.configuratorStep}>
          <div className={styles.stepHeading}>
            <span>{String(timingStepNumber).padStart(2, "0")}</span>
            <div>
              <h2>Timing and delivery</h2>
              <p>Tell us when you need it and how you prefer to receive it.</p>
            </div>
          </div>
          <div className={styles.timingPolicy}>
            <p>Please note that, by default, all orders have a <strong>production time of 5 business days from the date the order is placed</strong>.</p>
            <p>Estimated delivery times after production are:</p>
            <ul>
              <li><strong>New Zealand:</strong> 2–3 business days</li>
              <li><strong>Australia (Standard Delivery):</strong> approximately 5 business days</li>
            </ul>
            <p>If your order is <strong>urgent</strong>, please make sure to clearly let us know when placing your order so that we can arrange it accordingly and avoid any delays.</p>
          </div>
          <div className={`${styles.fieldGrid} ${styles.timingFields}`}>
            <label className={styles.formField}>
              <span>Production completion date</span>
              <input
                type="date"
                required
                min={addWorkingDays(orderDate, 1)}
                value={neededDate}
                onChange={(event) => {
                  setNeededDate(event.target.value);
                  setUrgentServiceConfirmed(false);
                }}
              />
            </label>
            {urgentService?.requiresConfirmation && (
              <label className={styles.urgentConfirmation}>
                <input
                  type="checkbox"
                  checked={urgentServiceConfirmed}
                  onChange={(event) => setUrgentServiceConfirmed(event.target.checked)}
                  aria-label="Confirm urgent service"
                />
                <span>
                  <strong>I need this order by the selected date and confirm urgent service.</strong>
                  <small>{formatMarketMoney(urgentService.feeInclGstCents, currency)}{taxSuffix}</small>
                </span>
              </label>
            )}
            <fieldset className={styles.formField} role="radiogroup">
              <legend>Delivery</legend>
              <div className={styles.deliveryChoices}>
                <label>
                  <input
                    type="radio"
                    name="delivery-preference"
                    checked={deliveryPreference === "post"}
                    onChange={() => setDeliveryPreference("post")}
                  />
                  Post
                </label>
                {market === "NZ" ? <label>
                  <input
                    type="radio"
                    name="delivery-preference"
                    checked={deliveryPreference === "pickup"}
                    onChange={() => setDeliveryPreference("pickup")}
                  />
                  Pickup
                </label> : null}
              </div>
              <p className={styles.deliveryScopeNote}>This choice applies to your whole order.</p>
            </fieldset>
          </div>
        </section>

        </form>
      </div>

      {relatedDesigns.length > 0 && (
        <section className={styles.configureRelatedDesigns} aria-label="Related designs">
          <header className={styles.configureRelatedHeader}>
            <div>
              <p className={styles.eyebrow}>Made by R&amp;R</p>
              <h2>Design inspiration</h2>
            </div>
            <Link className={styles.configureRelatedMore} href="/design-gallery">
              View all designs
            </Link>
          </header>
          <div className={styles.configureRelatedGrid}>
            {relatedDesigns.map((design) => (
              <Link
                className={styles.configureRelatedImageLink}
                href={`${market === "AU" ? "/au" : ""}/products/${design.productSlug}/configure?design=${design.id}`}
                key={design.id}
              >
                <Image
                  src={design.imageUrl}
                  alt={design.altText}
                  width={design.width}
                  height={design.height}
                  sizes="(max-width: 767px) 50vw, (max-width: 1180px) 33vw, 25vw"
                />
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
