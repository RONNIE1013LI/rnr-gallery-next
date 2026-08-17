"use client";

import Link from "next/link";
import { useState } from "react";
import type {
  PhotoSubmissionMethod,
  ProductConfigurationSchema,
} from "@/domain/configuration/types";
import { MAX_SOURCE_PHOTOS_PER_ITEM } from "@/domain/configuration/types";
import { MAX_CHECKOUT_TEXT_LENGTH } from "@/domain/checkout/input-schema";
import { formatMarketMoney } from "@/domain/money";
import { currencyForMarket } from "@/domain/markets/market";
import type { Market } from "@/domain/markets/types";
import styles from "./storefront.module.css";

export type UploadedFile = Readonly<{
  id: string;
  originalName: string;
  previewUrl?: string;
}>;

export type SourcePhotoCustomisationValue = Readonly<{
  photoSubmissionMethod: PhotoSubmissionMethod;
  designText: string;
  notes: string;
  uploadedFiles: readonly UploadedFile[];
  mainPhotoUploadId?: string;
  extraBackgroundRemovalUploadIds: readonly string[];
}>;

export type SourcePhotoCustomisationProps = Readonly<{
  groupLabel?: string;
  inputName: string;
  sourceStepNumber: number;
  artworkStepNumber: number;
  schema: ProductConfigurationSchema;
  market: Market;
  taxRegistered: boolean;
  backgroundRemovalFeeInclTaxCents?: number;
  value: SourcePhotoCustomisationValue;
  onChange: (value: SourcePhotoCustomisationValue) => void;
  onUploadingChange?: (uploading: boolean) => void;
}>;

export function SourcePhotoCustomisation({
  groupLabel,
  inputName,
  sourceStepNumber,
  artworkStepNumber,
  schema,
  market,
  taxRegistered,
  backgroundRemovalFeeInclTaxCents,
  value,
  onChange,
  onUploadingChange,
}: SourcePhotoCustomisationProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const supportsBackgroundRemoval =
    backgroundRemovalFeeInclTaxCents !== undefined;
  const activeBackgroundRemovalUploadIds =
    value.photoSubmissionMethod === "upload"
      ? value.extraBackgroundRemovalUploadIds
      : [];
  const currency = currencyForMarket(market);
  const taxSuffix = taxRegistered ? " incl GST" : "";
  const controlLabel = (label: string) =>
    groupLabel ? `${groupLabel}: ${label}` : label;

  function setPhotoSubmissionMethod(photoSubmissionMethod: PhotoSubmissionMethod) {
    onChange({ ...value, photoSubmissionMethod });
  }

  async function uploadSourceFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    onUploadingChange?.(true);
    setUploadError("");

    try {
      const maximum = schema.maximumSourcePhotos ?? MAX_SOURCE_PHOTOS_PER_ITEM;
      if (value.uploadedFiles.length + files.length > maximum) {
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
      onChange({
        ...value,
        uploadedFiles: [...value.uploadedFiles, ...uploaded],
        mainPhotoUploadId: value.mainPhotoUploadId ?? uploaded[0]?.id,
      });
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "The image could not be uploaded.",
      );
    } finally {
      setUploading(false);
      onUploadingChange?.(false);
    }
  }

  function removeUploadedFile(id: string) {
    const removed = value.uploadedFiles.find((file) => file.id === id);
    if (removed?.previewUrl && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(removed.previewUrl);
    }
    const remaining = value.uploadedFiles.filter((file) => file.id !== id);
    onChange({
      ...value,
      uploadedFiles: remaining,
      mainPhotoUploadId:
        value.mainPhotoUploadId === id
          ? remaining[0]?.id
          : value.mainPhotoUploadId,
      extraBackgroundRemovalUploadIds:
        value.extraBackgroundRemovalUploadIds.filter((uploadId) => uploadId !== id),
    });
  }

  function selectMainPhoto(id: string) {
    onChange({
      ...value,
      mainPhotoUploadId: id,
      extraBackgroundRemovalUploadIds:
        value.extraBackgroundRemovalUploadIds.filter((uploadId) => uploadId !== id),
    });
  }

  function toggleBackgroundRemoval(id: string) {
    onChange({
      ...value,
      extraBackgroundRemovalUploadIds:
        value.extraBackgroundRemovalUploadIds.includes(id)
          ? value.extraBackgroundRemovalUploadIds.filter((uploadId) => uploadId !== id)
          : [...value.extraBackgroundRemovalUploadIds, id],
    });
  }

  return (
    <>
      <section
        className={`${styles.configuratorStep} ${groupLabel ? styles.bundleCustomisationGroup : ""}`}
        aria-label={groupLabel}
      >
        <div className={styles.stepHeading}>
          <span>{String(sourceStepNumber).padStart(2, "0")}</span>
          <div>
            <h2>{groupLabel ?? "Upload original photos"}</h2>
            <p>Use the clearest original files you have.</p>
          </div>
        </div>
        <fieldset
          className={styles.choiceCards}
          role="radiogroup"
          aria-label={groupLabel
            ? `${groupLabel} photo submission`
            : "How will you send your photos?"}
        >
          <legend>How will you send your photos?</legend>
          <label>
            <input
              type="radio"
              name={inputName}
              checked={value.photoSubmissionMethod === "upload"}
              onChange={() => setPhotoSubmissionMethod("upload")}
            />
            <span><strong>Upload Photos Now</strong><small>Upload now — recommended for preserving original quality.</small></span>
          </label>
          <label>
            <input
              type="radio"
              name={inputName}
              checked={value.photoSubmissionMethod === "later"}
              onChange={() => setPhotoSubmissionMethod("later")}
            />
            <span><strong>Send Photos After Ordering</strong><small>Send later — send by Messenger, Email or WhatsApp after ordering.</small></span>
          </label>
        </fieldset>
        {value.photoSubmissionMethod === "upload" && (
          <div className={styles.uploadPanel}>
            <strong className={styles.uploadPanelTitle}>Choose photos or artwork files</strong>
            <label className={styles.uploadButton}>
              <span>{uploading ? "Uploading…" : "Choose files"}</span>
              <input
                type="file"
                multiple
                disabled={uploading}
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                aria-label={controlLabel("Choose files")}
                onChange={(event) => void uploadSourceFiles(event.target.files)}
              />
            </label>
            <p>{value.uploadedFiles.length > 0 ? "Files are ready. Choose a main photo or remove any file before adding to cart." : "Add clear original files. You can remove a file before adding to cart."}</p>
            <p>{schema.includedPhotos > 0 ? `Up to ${schema.includedPhotos} photos are included. Additional photos are charged from photo ${schema.includedPhotos + 1}.` : "Upload clear source photos. Source-photo count does not determine the price."}</p>
            {supportsBackgroundRemoval && <p>Choose one main photo. Background removal for the main photo is included. Select “Remove background” on any additional photo for {formatMarketMoney(backgroundRemovalFeeInclTaxCents, currency)}{taxSuffix} each.</p>}
            <p className={styles.uploadPrivacyNotice}>By uploading files, you confirm that you have permission to provide them. We use them to prepare and fulfil your order. Temporary uploads that are not attached to an order are normally deleted after seven days. <Link href="/privacy">Privacy Policy</Link></p>
            {value.uploadedFiles.length > 0 && <div className={styles.uploadPreviewGrid}>
              {value.uploadedFiles.map((file, index) => {
                const isMain = supportsBackgroundRemoval && file.id === value.mainPhotoUploadId;
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
                    <button type="button" className={backgroundRemovalSelected ? styles.backgroundSelected : undefined} aria-pressed={backgroundRemovalSelected} onClick={() => toggleBackgroundRemoval(file.id)}><span>{backgroundRemovalSelected ? "Background removal ✓" : "Remove background"}</span><strong>+{formatMarketMoney(backgroundRemovalFeeInclTaxCents, currency)}{taxSuffix}</strong></button>
                  </div> : null}
                </article>;
              })}
            </div>}
            {supportsBackgroundRemoval && value.uploadedFiles.length > 0 && value.mainPhotoUploadId && <dl className={styles.backgroundRemovalSummary}>
              <div><dt>Main photo</dt><dd>Photo {value.uploadedFiles.findIndex((file) => file.id === value.mainPhotoUploadId) + 1}</dd></div>
              <div><dt>Extra background removals</dt><dd>{activeBackgroundRemovalUploadIds.length}</dd></div>
              <div><dt>Background removal charge</dt><dd>{activeBackgroundRemovalUploadIds.length > 0 ? `${activeBackgroundRemovalUploadIds.length} × ${formatMarketMoney(backgroundRemovalFeeInclTaxCents, currency)}${taxSuffix}` : "None"}</dd></div>
            </dl>}
            {uploadError && <p className={styles.formError} role="alert">{uploadError}</p>}
          </div>
        )}
      </section>

      {schema.artworkDirectionMode !== "none" ? (
        <section
          className={styles.configuratorStep}
          aria-label={groupLabel ? `${groupLabel} artwork direction` : undefined}
        >
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
              value={value.designText}
              maxLength={MAX_CHECKOUT_TEXT_LENGTH}
              aria-label={controlLabel("Text for your design")}
              placeholder={"e.g. Top text: HAPPY 1ST BIRTHDAY\nBottom text: ETI JUNIOR COLLINS"}
              onChange={(event) => onChange({
                ...value,
                designText: event.target.value.slice(0, MAX_CHECKOUT_TEXT_LENGTH),
              })}
            />
          </label>
          <label className={styles.formField}>
            <span>Design notes</span>
            <textarea
              className={styles.exampleTextarea}
              value={value.notes}
              maxLength={MAX_CHECKOUT_TEXT_LENGTH}
              aria-label={controlLabel("Design notes")}
              placeholder="e.g. Background: Orange and white Polynesian pattern design"
              onChange={(event) => onChange({
                ...value,
                notes: event.target.value.slice(0, MAX_CHECKOUT_TEXT_LENGTH),
              })}
            />
          </label>
        </section>
      ) : null}
    </>
  );
}
