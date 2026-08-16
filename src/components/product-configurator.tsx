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
import type {
  DeliveryPreference,
  Orientation,
  PhotoSubmissionMethod,
  ProductConfigurationSchema,
} from "@/domain/configuration/types";
import { MAX_SOURCE_PHOTOS_PER_ITEM } from "@/domain/configuration/types";
import { quoteConfiguration } from "@/domain/configuration/quote";
import { formatConfigurationSizeLabel } from "@/domain/configuration/size-label";
import { addNzdGst, formatMarketMoney } from "@/domain/money";
import { currencyForMarket } from "@/domain/markets/market";
import type { Market } from "@/domain/markets/types";
import { quoteMarketConfiguration } from "@/domain/pricing/market-quote";
import { getPriceLineAmountInclGstCents } from "@/domain/pricing/types";
import {
  MAX_CHECKOUT_TEXT_LENGTH,
  MAX_PEOPLE_PETS_PER_ITEM,
} from "@/domain/checkout/input-schema";
import { createClientId } from "@/lib/client-id";
import {
  addWorkingDays,
  getUrgentService,
} from "@/domain/scheduling/urgent-service";
import styles from "./storefront.module.css";
import { useContainedDialog } from "./forms/use-contained-dialog";
import type { GalleryDesignSelection } from "@/server/gallery/design-selection-service";
import { PurchaseTrustStrip } from "./purchase-trust-strip";

export type ProductConfiguratorRelatedDesign = Readonly<{
  id: string;
  title: string;
  altText: string;
  imageUrl: string;
  width: number;
  height: number;
  productSlug: string;
}>;

type ProductConfiguratorProps = Readonly<{
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

type UploadedFile = Readonly<{
  id: string;
  originalName: string;
  previewUrl?: string;
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
  const [photoSubmissionMethod, setPhotoSubmissionMethod] =
    useState<PhotoSubmissionMethod>(schema.defaultPhotoSubmissionMethod);
  const [designText, setDesignText] = useState("");
  const [notes, setNotes] = useState("");
  const [neededDate, setNeededDate] = useState(() => addWorkingDays(orderDate, 5));
  const [urgentServiceConfirmed, setUrgentServiceConfirmed] = useState(false);
  const [deliveryPreference, setDeliveryPreference] =
    useState<DeliveryPreference>(schema.defaultDeliveryPreference);
  const [uploadedFiles, setUploadedFiles] = useState<readonly UploadedFile[]>([]);
  const [mainPhotoUploadId, setMainPhotoUploadId] = useState<string | undefined>();
  const [extraBackgroundRemovalUploadIds, setExtraBackgroundRemovalUploadIds] =
    useState<readonly string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [added, setAdded] = useState(false);
  const [isPreviewZoomOpen, setIsPreviewZoomOpen] = useState(false);
  const previewZoomTriggerRef = useRef<HTMLButtonElement>(null);
  const previewZoomDialogRef = useRef<HTMLDivElement>(null);
  const previewZoomCloseRef = useRef<HTMLButtonElement>(null);
  const closePreviewZoom = useCallback(() => setIsPreviewZoomOpen(false), []);

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

  async function uploadSourceFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setUploadError("");

    try {
      const maximum = schema.maximumSourcePhotos ?? MAX_SOURCE_PHOTOS_PER_ITEM;
      if (uploadedFiles.length + files.length > maximum) {
        throw new Error(`Choose no more than ${maximum} source photos.`);
      }

      const uploaded: UploadedFile[] = [];
      for (const file of Array.from(files)) {
          const data = new FormData();
          data.set("file", file);
          const response = await fetch("/api/uploads", { method: "POST", body: data });
          const body = await response.json() as {
            reference?: UploadedFile;
            error?: string;
          };
          if (!response.ok || !body.reference) {
            throw new Error(body.error ?? "The image could not be uploaded.");
          }
          uploaded.push({
            ...body.reference,
            ...(typeof URL.createObjectURL === "function"
              ? { previewUrl: URL.createObjectURL(file) }
              : {}),
          });
      }
      setUploadedFiles((current) => [...current, ...uploaded]);
      if (!mainPhotoUploadId && uploaded[0]) {
        setMainPhotoUploadId(uploaded[0].id);
      }
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "The image could not be uploaded.",
      );
    } finally {
      setUploading(false);
    }
  }

  function removeUploadedFile(id: string) {
    const removed = uploadedFiles.find((file) => file.id === id);
    if (removed?.previewUrl && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(removed.previewUrl);
    }
    const remaining = uploadedFiles.filter((file) => file.id !== id);
    setUploadedFiles(remaining);
    if (mainPhotoUploadId === id) {
      setMainPhotoUploadId(remaining[0]?.id);
    }
    setExtraBackgroundRemovalUploadIds((current) => current.filter((uploadId) => uploadId !== id));
  }

  function selectMainPhoto(id: string) {
    setMainPhotoUploadId(id);
    setExtraBackgroundRemovalUploadIds((current) => current.filter((uploadId) => uploadId !== id));
  }

  function toggleBackgroundRemoval(id: string) {
    setExtraBackgroundRemovalUploadIds((current) =>
      current.includes(id)
        ? current.filter((uploadId) => uploadId !== id)
        : [...current, id],
    );
  }

  function addToCart() {
    if (addDisabled || !urgentService) return;
    const repository = createBrowserCartRepository(window.localStorage);
    const cart = setCartDeliveryPreference(addCartItem(repository.load(), {
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
    }), deliveryPreference);
    repository.save(cart);
    notifyCartChanged();
    setAdded(true);
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
          <p className={styles.eyebrow}>Your custom artwork</p>
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
                  const priceLabel = `From ${formatMarketMoney(option.minimumPriceInclTaxCents, currency)}${taxSuffix}`;
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

        <section className={styles.configuratorStep}>
          <div className={styles.stepHeading}>
            <span>{String(sourceStepNumber).padStart(2, "0")}</span>
            <div>
              <h2>Upload original photos</h2>
              <p>Use the clearest original files you have.</p>
            </div>
          </div>
          <fieldset className={styles.choiceCards}>
            <legend>How will you send your photos?</legend>
            <label>
              <input
                type="radio"
                name="photo-submission"
                checked={photoSubmissionMethod === "upload"}
                onChange={() => setPhotoSubmissionMethod("upload")}
              />
              <span><strong>Upload Photos Now</strong><small>Upload now — recommended for preserving original quality.</small></span>
            </label>
            <label>
              <input
                type="radio"
                name="photo-submission"
                checked={photoSubmissionMethod === "later"}
                onChange={() => setPhotoSubmissionMethod("later")}
              />
              <span><strong>Send Photos After Ordering</strong><small>Send later — send by Messenger, Email or WhatsApp after ordering.</small></span>
            </label>
          </fieldset>
          {photoSubmissionMethod === "upload" && (
            <div className={styles.uploadPanel}>
              <strong className={styles.uploadPanelTitle}>Choose photos or artwork files</strong>
              <label className={styles.uploadButton}>
                <span>{uploading ? "Uploading…" : "Choose files"}</span>
                <input
                  type="file"
                  multiple
                  disabled={uploading}
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                  aria-label="Choose files"
                  onChange={(event) => void uploadSourceFiles(event.target.files)}
                />
              </label>
              <p>{uploadedFiles.length > 0 ? "Files are ready. Choose a main photo or remove any file before adding to cart." : "Add clear original files. You can remove a file before adding to cart."}</p>
              <p>{schema.includedPhotos > 0 ? `Up to ${schema.includedPhotos} photos are included. Additional photos are charged from photo ${schema.includedPhotos + 1}.` : "Upload clear source photos. Source-photo count does not determine the price."}</p>
              {supportsBackgroundRemoval && <p>Choose one main photo. Background removal for the main photo is included. Select “Remove background” on any additional photo for {formatMarketMoney(marketBook?.products.find((entry) => entry.productKey === product.key)?.charges.find((charge) => charge.key === "background-removal")?.amountInclTaxCents ?? schema.extraBackgroundRemovalFeeInclGstCents!, currency)}{taxSuffix} each.</p>}
              <p className={styles.uploadPrivacyNotice}>By uploading files, you confirm that you have permission to provide them. We use them to prepare and fulfil your order. Temporary uploads that are not attached to an order are normally deleted after seven days. <Link href="/privacy">Privacy Policy</Link></p>
              {uploadedFiles.length > 0 && <div className={styles.uploadPreviewGrid}>
                {uploadedFiles.map((file, index) => {
                  const isMain = supportsBackgroundRemoval && file.id === mainPhotoUploadId;
                  const backgroundRemovalSelected = activeBackgroundRemovalUploadIds.includes(file.id);
                  return <article className={styles.uploadPreviewCard} key={file.id}>
                    <div className={styles.uploadPreviewMedia}>
                      {file.previewUrl ? (
                        // Local blob URLs are intentionally used for private, pre-order file previews.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={file.previewUrl} alt={`Preview of Photo ${index + 1}`} />
                      ) : <span>Photo {index + 1}</span>}
                      <button
                        type="button"
                        className={styles.uploadPreviewRemove}
                        aria-label={`Remove Photo ${index + 1}`}
                        onClick={() => removeUploadedFile(file.id)}
                      >
                        <span className={styles.uploadPreviewRemoveIcon} aria-hidden="true">×</span>
                      </button>
                    </div>
                    <strong>Photo {index + 1}</strong>
                    {isMain ? <><span className={styles.mainPhotoBadge}>Main photo</span><span className={styles.backgroundIncluded}>Background removal included</span></> : supportsBackgroundRemoval ? <div className={styles.uploadPreviewActions}>
                      <button type="button" onClick={() => selectMainPhoto(file.id)}>Set as main</button>
                      <button type="button" className={backgroundRemovalSelected ? styles.backgroundSelected : undefined} aria-pressed={backgroundRemovalSelected} onClick={() => toggleBackgroundRemoval(file.id)}><span>{backgroundRemovalSelected ? "Background removal ✓" : "Remove background"}</span><strong>+{formatMarketMoney(marketBook?.products.find((entry) => entry.productKey === product.key)?.charges.find((charge) => charge.key === "background-removal")?.amountInclTaxCents ?? schema.extraBackgroundRemovalFeeInclGstCents!, currency)}{taxSuffix}</strong></button>
                    </div> : null}
                  </article>;
                })}
              </div>}
              {supportsBackgroundRemoval && uploadedFiles.length > 0 && mainPhotoUploadId && <dl className={styles.backgroundRemovalSummary}>
                <div><dt>Main photo</dt><dd>Photo {uploadedFiles.findIndex((file) => file.id === mainPhotoUploadId) + 1}</dd></div>
                <div><dt>Extra background removals</dt><dd>{activeBackgroundRemovalUploadIds.length}</dd></div>
                <div><dt>Background removal charge</dt><dd>{activeBackgroundRemovalUploadIds.length > 0 ? `${activeBackgroundRemovalUploadIds.length} × ${formatMarketMoney(marketBook?.products.find((entry) => entry.productKey === product.key)?.charges.find((charge) => charge.key === "background-removal")?.amountInclTaxCents ?? schema.extraBackgroundRemovalFeeInclGstCents!, currency)}${taxSuffix}` : "None"}</dd></div>
              </dl>}
              {uploadError && <p className={styles.formError} role="alert">{uploadError}</p>}
            </div>
          )}
        </section>

        {showArtworkDirection ? (
        <section className={styles.configuratorStep}>
          <div className={styles.stepHeading}>
            <span>{String(artworkStepNumber).padStart(2, "0")}</span>
            <div>
              <h2>Artwork direction</h2>
              <p>Add wording, photo order, colours and the feeling you want.</p>
            </div>
          </div>
          <label className={styles.formField}>
            <span>Text for your design</span>
            <textarea
              className={styles.exampleTextarea}
              value={designText}
              maxLength={MAX_CHECKOUT_TEXT_LENGTH}
              placeholder={"e.g. Top text: HAPPY 1ST BIRTHDAY\nBottom text: ETI JUNIOR COLLINS"}
              onChange={(event) =>
                setDesignText(event.target.value.slice(0, MAX_CHECKOUT_TEXT_LENGTH))
              }
            />
          </label>
          <label className={styles.formField}>
            <span>Design notes</span>
            <textarea
              className={styles.exampleTextarea}
              value={notes}
              maxLength={MAX_CHECKOUT_TEXT_LENGTH}
              placeholder="e.g. Background: Orange and white Polynesian pattern design"
              onChange={(event) =>
                setNotes(event.target.value.slice(0, MAX_CHECKOUT_TEXT_LENGTH))
              }
            />
          </label>
        </section>
        ) : null}

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
