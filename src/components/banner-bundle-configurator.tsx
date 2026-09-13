"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import {
  BANNER_BUNDLE_INCLUDED_PHOTOS_PER_COMPONENT,
  flattenBannerBundleUploadReferences,
  validateBannerBundleComponents,
  type BannerBundleComponentCustomization,
  type BannerBundleComponentKey,
} from "@/domain/bundles/banner-bundle";
import { getActiveCartStorageKey } from "@/domain/cart/browser-cart-scope";
import { needsProductionServiceReview, restoreCartPhotos, replaceConfiguredCartItem } from "./cart-configuration-edit";
import { createBrowserCartRepository } from "@/domain/cart/browser-cart-repository";
import { notifyCartChanged } from "@/domain/cart/browser-cart-events";
import { addCartItem, setCartDeliveryPreference } from "@/domain/cart/cart";
import type { CartItem } from "@/domain/cart/types";
import { emitAnalyticsEvent } from "@/domain/analytics/client";
import { buildCartItemEvent } from "@/domain/analytics/events";
import type { DeliveryPreference } from "@/domain/configuration/types";
import { estimatedArrival, getCustomerTiming } from "@/domain/scheduling/customer-timing";
import { ConfigurationFlow, ConfigurationStep, ConfigurationReviewButton } from "./configuration-flow";
import { ConfigurationTiming } from "./configuration-timing";
import { ConfigurationDraft } from "./configuration-draft";
import flowStyles from "./configuration-flow.module.css";
import { formatConfigurationSizeLabel } from "@/domain/configuration/size-label";
import { currencyForMarket } from "@/domain/markets/market";
import { formatMarketMoney } from "@/domain/money";
import { quoteMarketConfiguration } from "@/domain/pricing/market-quote";
import { getPriceLineAmountInclGstCents } from "@/domain/pricing/types";
import {
  addWorkingDays,
  STANDARD_PRODUCTION_WORKING_DAYS,
  getUrgentService,
} from "@/domain/scheduling/urgent-service";
import { createClientId } from "@/lib/client-id";
import type { ProductConfiguratorProps } from "./product-configurator";
import { PurchaseTrustStrip } from "./purchase-trust-strip";
import {
  SourcePhotoCustomisation,
  type SourcePhotoCustomisationValue,
} from "./source-photo-customisation";
import styles from "./storefront.module.css";
import { useContainedDialog } from "./forms/use-contained-dialog";
import { AnalyticsEventTracker } from "./analytics-event-tracker";

export type BannerBundleConfiguratorProps = ProductConfiguratorProps;

const BANNER_BUNDLE_SIZE_OPTION_LABELS: Record<string, string> = {
  "rollup-wall-200x100": "Roll Up Banner + 200 x 100 cm Wall Banner",
  "rollup-wall-300x150": "Roll Up Banner + 300 x 150 cm Wall Banner",
};

const BANNER_BUNDLE_WALL_SIZE_LABELS: Record<string, string> = {
  "rollup-wall-200x100": "200 x 100 cm",
  "rollup-wall-300x150": "300 x 150 cm",
};

function initialCustomisation(
  photoSubmissionMethod: SourcePhotoCustomisationValue["photoSubmissionMethod"],
): SourcePhotoCustomisationValue {
  return {
    photoSubmissionMethod,
    designText: "",
    notes: "",
    uploadedFiles: [],
    extraBackgroundRemovalUploadIds: [],
  };
}

function activeUploadReferences(value: SourcePhotoCustomisationValue): readonly string[] {
  return value.photoSubmissionMethod === "upload"
    ? value.uploadedFiles.map((file) => file.id)
    : [];
}

function activeBackgroundRemovals(
  value: SourcePhotoCustomisationValue,
): readonly string[] {
  return value.photoSubmissionMethod === "upload"
    ? value.extraBackgroundRemovalUploadIds
    : [];
}

function componentSnapshot(
  componentKey: BannerBundleComponentKey,
  value: SourcePhotoCustomisationValue,
): BannerBundleComponentCustomization {
  const uploadReferences = activeUploadReferences(value);
  if (value.photoSubmissionMethod === "later") {
    return {
      componentKey,
      photoSubmissionMethod: "later",
      designText: value.designText,
      notes: value.notes,
      uploadReferences,
    };
  }
  const extraBackgroundRemovalUploadIds = activeBackgroundRemovals(value);
  return {
    componentKey,
    photoSubmissionMethod: "upload",
    designText: value.designText,
    notes: value.notes,
    uploadReferences,
    ...(value.mainPhotoUploadId
      ? { mainPhotoUploadId: value.mainPhotoUploadId }
      : {}),
    ...(extraBackgroundRemovalUploadIds.length > 0
      ? { extraBackgroundRemovalUploadIds }
      : {}),
  };
}

export function BannerBundleConfigurator({
  product,
  schema,
  registry = defaultProductRegistry,
  market = "NZ",
  orderDate,
  createId = createClientId,
  selectedDesign = null,
  initialSizeKey,
  editingItem,
  editingCartStorageKey,
}: BannerBundleConfiguratorProps) {
  const [sizeKey, setSizeKey] = useState(
    initialSizeKey && schema.sizes.some((size) => size.key === initialSizeKey)
      ? initialSizeKey
      : schema.defaultSizeKey,
  );
  const [rollUp, setRollUp] = useState<SourcePhotoCustomisationValue>(() =>
    editingItem?.bundleComponents ? restoreCartPhotos(editingItem.bundleComponents.find((component) => component.componentKey === "roll-up")!) : initialCustomisation(schema.defaultPhotoSubmissionMethod));
  const [wallBanner, setWallBanner] = useState<SourcePhotoCustomisationValue>(() =>
    editingItem?.bundleComponents ? restoreCartPhotos(editingItem.bundleComponents.find((component) => component.componentKey === "wall-banner")!) : initialCustomisation(schema.defaultPhotoSubmissionMethod));
  const [rollUpUploading, setRollUpUploading] = useState(false);
  const [wallBannerUploading, setWallBannerUploading] = useState(false);
  const [needByDate, setNeedByDate] = useState(() => editingItem?.eventDate ?? estimatedArrival(addWorkingDays(orderDate, STANDARD_PRODUCTION_WORKING_DAYS), market, schema.defaultDeliveryPreference).end);
  const [productionDays, setProductionDays] = useState(editingItem && [1, 2, 3].includes(editingItem.productionWorkingDays ?? 3) ? editingItem.productionWorkingDays ?? 3 : 3);
  const [productionServiceReviewed, setProductionServiceReviewed] = useState(!editingItem || !needsProductionServiceReview(editingItem));
  const [saveError, setSaveError] = useState("");
  const urgentServiceConfirmed = productionDays < STANDARD_PRODUCTION_WORKING_DAYS;
  const [deliveryPreference, setDeliveryPreference] =
    useState<DeliveryPreference>(editingItem?.deliveryPreference ?? schema.defaultDeliveryPreference);
  const neededDate = addWorkingDays(orderDate, productionDays);
  const timing = getCustomerTiming(orderDate, needByDate, market, market === "AU" ? "post" : deliveryPreference, neededDate);
  const [added, setAdded] = useState(false);
  const [isPreviewZoomOpen, setIsPreviewZoomOpen] = useState(false);
  const previewZoomTriggerRef = useRef<HTMLButtonElement>(null);
  const previewZoomDialogRef = useRef<HTMLDivElement>(null);
  const previewZoomCloseRef = useRef<HTMLButtonElement>(null);
  const closePreviewZoom = useCallback(() => setIsPreviewZoomOpen(false), []);
  const componentSchema = useMemo(() => ({
    ...schema,
    includedPhotos: BANNER_BUNDLE_INCLUDED_PHOTOS_PER_COMPONENT,
  }), [schema]);

  useContainedDialog({
    active: isPreviewZoomOpen,
    dialogRef: previewZoomDialogRef,
    initialFocusRef: previewZoomCloseRef,
    isolationRootRef: previewZoomDialogRef,
    returnFocusRef: previewZoomTriggerRef,
    onClose: closePreviewZoom,
  });

  const size = schema.sizes.find((option) => option.key === sizeKey)!;
  const sizeLabel = formatConfigurationSizeLabel(size);
  const displaySizeLabel = BANNER_BUNDLE_SIZE_OPTION_LABELS[size.key] ?? sizeLabel;
  const previewImage = selectedDesign?.imageUrl ?? product.image.src;
  const previewAlt = selectedDesign?.altText ?? product.image.alt;
  const currency = currencyForMarket(market);
  const marketBook = registry.markets[market];
  const taxRegistered = market === "NZ" || marketBook.tax.registered === true;
  const taxSuffix = taxRegistered ? " incl GST" : "";
  const bundlePrices = marketBook.products.find(
    (entry) => entry.productKey === product.key,
  );
  const rollUpBackgroundRemovalFee = bundlePrices?.charges.find(
    (charge) => charge.key === "roll-up-background-removal",
  )?.amountInclTaxCents ?? undefined;
  const wallBannerBackgroundRemovalFee = bundlePrices?.charges.find(
    (charge) => charge.key === "wall-banner-background-removal",
  )?.amountInclTaxCents ?? undefined;
  const rollUpUploadReferences = activeUploadReferences(rollUp);
  const wallBannerUploadReferences = activeUploadReferences(wallBanner);
  const rollUpBackgroundRemovals = activeBackgroundRemovals(rollUp);
  const wallBannerBackgroundRemovals = activeBackgroundRemovals(wallBanner);
  const urgentFees = useMemo(
    () => marketBook.urgentServiceFees.map((fee) => fee.amountInclTaxCents ?? 0),
    [marketBook],
  );
  const urgentService = useMemo(() => {
    try {
      return getUrgentService(orderDate, neededDate, urgentFees);
    } catch {
      return null;
    }
  }, [neededDate, orderDate, urgentFees]);
  const emptyBundleCounts = useMemo(() => ({
    rollUpExtraPhotos: 0,
    wallBannerExtraPhotos: 0,
    rollUpBackgroundRemovals: 0,
    wallBannerBackgroundRemovals: 0,
  }), []);
  const sizeChoices = useMemo(
    () => schema.sizes.map((option) => ({
      key: option.key,
      label: BANNER_BUNDLE_SIZE_OPTION_LABELS[option.key]
        ?? formatConfigurationSizeLabel(option),
      wallBannerSize: BANNER_BUNDLE_WALL_SIZE_LABELS[option.key]
        ?? formatConfigurationSizeLabel(option),
      minimumPriceInclTaxCents: quoteMarketConfiguration(
        registry,
        market,
        product.key,
        {
          sizeKey: option.key,
          peoplePets: 0,
          bundleCounts: emptyBundleCounts,
        },
      ).totalInclGstCents,
    })),
    [emptyBundleCounts, market, product.key, registry, schema.sizes],
  );
  const quote = useMemo(
    () => quoteMarketConfiguration(registry, market, product.key, {
      sizeKey,
      peoplePets: 0,
      bundleCounts: {
        rollUpExtraPhotos: Math.max(
          0,
          rollUpUploadReferences.length - BANNER_BUNDLE_INCLUDED_PHOTOS_PER_COMPONENT,
        ),
        wallBannerExtraPhotos: Math.max(
          0,
          wallBannerUploadReferences.length - BANNER_BUNDLE_INCLUDED_PHOTOS_PER_COMPONENT,
        ),
        rollUpBackgroundRemovals: rollUpBackgroundRemovals.length,
        wallBannerBackgroundRemovals: wallBannerBackgroundRemovals.length,
      },
      urgentWorkingDays:
        urgentServiceConfirmed && urgentService?.requiresConfirmation
          ? urgentService.workingDays
          : undefined,
    }),
    [
      market,
      product.key,
      registry,
      rollUpBackgroundRemovals.length,
      rollUpUploadReferences.length,
      sizeKey,
      urgentService,
      urgentServiceConfirmed,
      wallBannerBackgroundRemovals.length,
      wallBannerUploadReferences.length,
    ],
  );
  const uploadRequired = [rollUp, wallBanner].some((value) =>
    value.photoSubmissionMethod === "upload" &&
    value.uploadedFiles.length < schema.minimumSourcePhotos);
  const addDisabled =
    !productionServiceReviewed || rollUpUploading || wallBannerUploading || uploadRequired ||
    !urgentService;

  function addToCart() {
    if (addDisabled || !urgentService) return;
    if (editingItem && editingCartStorageKey !== getActiveCartStorageKey()) {
      setSaveError("Your customer session changed. Return to your cart and open the item again.");
      return;
    }
    const effectiveDeliveryPreference = market === "AU" ? "post" : deliveryPreference;
    const bundleComponents = validateBannerBundleComponents([
      componentSnapshot("roll-up", rollUp),
      componentSnapshot("wall-banner", wallBanner),
    ]);
    const uploadReferences = flattenBannerBundleUploadReferences(bundleComponents);
    const repository = createBrowserCartRepository(window.localStorage);
    const item: CartItem = {
      id: editingItem?.id ?? createId(),
      productKey: product.key,
      productSlug: product.slug,
      productTitle: product.title,
      imageSrc: product.image.src,
      ...((selectedDesign?.id ?? editingItem?.galleryDesignId) ? { galleryDesignId: selectedDesign?.id ?? editingItem?.galleryDesignId } : {}),
      sizeKey,
      sizeLabel,
      peoplePets: 0,
      photoSubmissionMethod: uploadReferences.length > 0 ? "upload" : "later",
      designText: "",
      notes: "",
      neededDate,
      productionWorkingDays: productionDays,
      eventDate: needByDate,
      urgentServiceConfirmed,
      urgentFeeInclGstCents: urgentService.feeInclGstCents,
      deliveryPreference: effectiveDeliveryPreference,
      quantity: editingItem?.quantity ?? 1,
      price: quote,
      uploadReferences,
      bundleComponents,
    };
    try {
      const current = repository.load();
      const cart = editingItem
        ? replaceConfiguredCartItem(current, editingItem, item)
        : setCartDeliveryPreference(addCartItem(current, item), effectiveDeliveryPreference);
      repository.save(cart);
    } catch {
      setSaveError("This cart item changed while you were editing. Return to your cart and open it again.");
      return;
    }
    notifyCartChanged();
    setAdded(true);
    try {
      if (!editingItem) emitAnalyticsEvent(buildCartItemEvent("add_to_cart", item));
    } catch {
      // Analytics must never change a successfully persisted cart action.
    }
  }

  return (
    <ConfigurationFlow total={7}>
      <AnalyticsEventTracker
        event={selectedDesign ? {
          event: "design_selected",
          design_id: selectedDesign.id,
          product_id: product.key,
        } : null}
        scopeKey={`${product.key}:${selectedDesign?.id ?? "none"}`}
      />
      <div className={flowStyles.compactSummary} aria-label="Current price">
        <div><strong>{formatMarketMoney(quote.totalInclGstCents, currency)}{taxSuffix}</strong>
        <p>Selected options included. Delivery calculated at checkout.</p></div>
        <ConfigurationReviewButton />
      </div>
      <div className={`${styles.configuratorLayout} ${flowStyles.layout}`}>
        <div className={`${styles.configuratorSidebar} ${flowStyles.sidebar}`}>
          <section className={styles.artworkPreview} aria-label="Artwork preview">
            <div className={styles.artworkPreviewMedia}>
              <Image
                src={previewImage}
                alt={previewAlt}
                fill
                priority
                sizes="(max-width: 340px) calc(100vw - 1.7rem), (max-width: 500px) 92vw, (max-width: 650px) calc(100vw - 2.5rem), (max-width: 820px) 92vw, (max-width: 1103px) calc(87vw - 20rem), (max-width: 1565px) 58vw, 907px"
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
                <div><dt>Format</dt><dd>{displaySizeLabel}</dd></div>
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


        </div>

        <form
          id="customise"
          className={styles.configuratorForm}
          onSubmit={(event) => {
            event.preventDefault();
            addToCart();
          }}
        >
        {!editingItem ? <ConfigurationDraft
          scope={`${market}:${product.key}:${selectedDesign?.id ?? "none"}`}
          allowedSizes={schema.sizes.map((option) => option.key)}
          options={{ sizeKey, peoplePets: 0, needByDate, deliveryPreference, photoMethods: [rollUp.photoSubmissionMethod, wallBanner.photoSubmissionMethod] }}
          onRestore={(draft) => {
            setSizeKey(draft.sizeKey); setNeedByDate(draft.needByDate); setDeliveryPreference(market === "AU" ? "post" : draft.deliveryPreference); setProductionDays(STANDARD_PRODUCTION_WORKING_DAYS);
            setRollUp((value) => ({ ...value, photoSubmissionMethod: draft.photoMethods[0] }));
            setWallBanner((value) => ({ ...value, photoSubmissionMethod: draft.photoMethods[1] }));
          }}
        /> : null}

          <ConfigurationStep number={1} title="Choose the format">
<section className={styles.configuratorStep}>
            <div className={styles.stepHeading}>
              <span>01</span>
              <div>
                <h2>Choose the format</h2>
                <p>Select the Roll-Up and Wall Banner size combination.</p>
              </div>
            </div>
            <fieldset className={styles.sizePicker} role="radiogroup">
              <legend className="sr-only">Size</legend>
              <div className={styles.bundleSizeHeader} aria-hidden="true">
                <span>Size</span>
                <strong>Roll Up Banner +</strong>
              </div>
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
                      <span className={`${styles.sizeOptionBody} ${styles.bundleSizeOptionBody}`}>
                        <span className={styles.bundleSizeDescription}>
                          <strong>Wall Banner</strong>
                          <small>{option.wallBannerSize}</small>
                        </span>
                        <span>{priceLabel}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </section>
        </ConfigurationStep>

          <SourcePhotoCustomisation
            analyticsProductId={`${product.key}:roll-up-banner`}
            groupLabel="Roll-Up Banner customisation"
            inputName="roll-up-photo-submission"
            sourceStepNumber={2}
            artworkStepNumber={3}
            schema={componentSchema}
            market={market}
            taxRegistered={taxRegistered}
            backgroundRemovalFeeInclTaxCents={rollUpBackgroundRemovalFee}
            value={rollUp}
            onChange={setRollUp}
            onUploadingChange={setRollUpUploading}
          />
          <SourcePhotoCustomisation
            analyticsProductId={`${product.key}:wall-banner`}
            groupLabel="Wall Banner customisation"
            inputName="wall-banner-photo-submission"
            sourceStepNumber={4}
            artworkStepNumber={5}
            schema={componentSchema}
            market={market}
            taxRegistered={taxRegistered}
            backgroundRemovalFeeInclTaxCents={wallBannerBackgroundRemovalFee}
            value={wallBanner}
            onChange={setWallBanner}
            onUploadingChange={setWallBannerUploading}
          />

          <ConfigurationStep number={6} title="Timing and delivery">
<section className={styles.configuratorStep}>
            <div className={styles.stepHeading}>
              <span>06</span>
              <div>
                <h2>Timing and delivery</h2>
                <p>Tell us when you need it and how you prefer to receive it.</p>
              </div>
            </div>
            <ConfigurationTiming orderDate={orderDate} needByDate={needByDate} market={market} deliveryPreference={deliveryPreference} productionDate={neededDate} onChange={setNeedByDate} />
          <div className={`${styles.fieldGrid} ${styles.timingFields}`}>
            <label className={styles.formField}>
              <span>Production service</span>
              {!productionServiceReviewed ? <p role="status">Please choose your production service again. Your saved cart stays unchanged until you save.</p> : null}
              <select aria-label="Production service" value={productionServiceReviewed ? productionDays : ""} onChange={(event) => { setProductionDays(Number(event.target.value)); setProductionServiceReviewed(true); }}>
                {!productionServiceReviewed ? <option value="" disabled>Choose production service</option> : null}
                <option value={3}>Standard — 3 business days</option>
                {[2, 1].map((days) => <option key={days} value={days}>Optional rush — {days} business {days === 1 ? "day" : "days"} (+{formatMarketMoney(getUrgentService(orderDate, addWorkingDays(orderDate, days), urgentFees).feeInclGstCents, currency)}{taxSuffix})</option>)}
              </select>
              <small>Selecting optional rush confirms its displayed fee. Delivery time is separate and is not guaranteed.</small>
            </label>
            {market === "NZ" ? <fieldset className={styles.formField} role="radiogroup">
                <legend>Delivery</legend>
                <div className={styles.deliveryChoices}>
                  <label>
                    <input
                      type="radio"
                      name="delivery-preference"
                      checked={deliveryPreference === "post"}
                      onChange={() => { setDeliveryPreference("post"); }}
                    />
                    Post
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="delivery-preference"
                      checked={deliveryPreference === "pickup"}
                      onChange={() => { setDeliveryPreference("pickup"); }}
                    />
                    Pickup
                  </label>
                </div>
                <p className={styles.deliveryScopeNote}>This choice applies to your whole order.</p>
              </fieldset> : null}
            </div>
          </section>
        </ConfigurationStep>
        <ConfigurationStep number={7} title={editingItem ? "Review and save configuration" : "Review and add to cart"}>
          <aside className={styles.priceSummary} aria-label="Order summary">
            <p className={styles.eyebrow}>Estimated price</p>
            <h2>Order summary</h2>
            <p>{product.title}</p>
            <dl className={styles.summaryDetails}>
              <div><dt>Size</dt><dd>{displaySizeLabel}</dd></div>
            </dl>
            <dl className={styles.priceLines}>
              {quote.lines.map((line) => (
                <div key={line.key}>
                  <dt>{line.label}</dt>
                  <dd>{formatMarketMoney(getPriceLineAmountInclGstCents(line), currency)}{taxSuffix}</dd>
                </div>
              ))}
              {taxRegistered ? <div>
                <dt>{market === "NZ" ? "Includes GST (15%)" : "Includes Australian GST"}</dt>
                <dd>{formatMarketMoney(quote.gstCents, currency)}</dd>
              </div> : null}
              <div className={styles.priceTotal}>
                <dt>{taxRegistered ? "Total incl GST" : "Total"}</dt>
                <dd>{formatMarketMoney(quote.totalInclGstCents, currency)}</dd>
              </div>
            </dl>
            <p>Need-by date: {needByDate || "Choose a date"}. Estimated production completion: {neededDate}.</p>
          {timing.error ? <p role="status" className={flowStyles.warning}>{timing.error}</p> : null}
          <PurchaseTrustStrip />
            <button
              className={styles.primaryButton}
              type="button"
              disabled={addDisabled || Boolean(editingItem && added)}
              onClick={addToCart}
            >
            {uploadRequired
              ? "Upload a source photo to continue"
              : editingItem ? "Save configuration"

                  : rollUp.photoSubmissionMethod === "later" &&
                      wallBanner.photoSubmissionMethod === "later"
                    ? "Add to Cart — Send Photos Later"
                    : "Add to cart"}
            </button>
            {saveError ? <p role="alert">{saveError} <Link href="/cart">Return to cart</Link></p> : null}
          {added && (
              <p className={styles.addedMessage} role="status">
                <span>{editingItem ? "Configuration saved." : "Added to your cart."}</span>
                <Link className={styles.addedMessageAction} href="/cart">View cart</Link>
              </p>
            )}
          </aside>
        </ConfigurationStep>
        </form>
      </div>
    </ConfigurationFlow>
  );
}
