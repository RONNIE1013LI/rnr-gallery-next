import {
  MAX_SOURCE_PHOTOS_PER_ITEM,
  type PhotoSubmissionMethod,
} from "@/domain/configuration/types";

export type BannerBundleComponentKey = "roll-up" | "wall-banner";

export type BannerBundleComponentCustomization = Readonly<{
  componentKey: BannerBundleComponentKey;
  photoSubmissionMethod: PhotoSubmissionMethod;
  designText: string;
  notes: string;
  uploadReferences: readonly string[];
  mainPhotoUploadId?: string;
  extraBackgroundRemovalUploadIds?: readonly string[];
}>;

function invalid(message: string): never {
  throw new TypeError(message);
}

function freezeComponent(
  component: BannerBundleComponentCustomization,
): BannerBundleComponentCustomization {
  const uploadReferences = Object.freeze([...component.uploadReferences]);
  if (uploadReferences.length > MAX_SOURCE_PHOTOS_PER_ITEM) {
    invalid(`Each Banner Bundle component accepts at most ${MAX_SOURCE_PHOTOS_PER_ITEM} uploads.`);
  }
  if (new Set(uploadReferences).size !== uploadReferences.length) {
    invalid("Upload references must be unique within each Banner Bundle component.");
  }

  const extraBackgroundRemovalUploadIds = Object.freeze([
    ...(component.extraBackgroundRemovalUploadIds ?? []),
  ]);
  if (
    new Set(extraBackgroundRemovalUploadIds).size !==
      extraBackgroundRemovalUploadIds.length
  ) {
    invalid("Background removal selections must be unique.");
  }

  if (component.photoSubmissionMethod === "later") {
    if (
      uploadReferences.length > 0 ||
      component.mainPhotoUploadId !== undefined ||
      extraBackgroundRemovalUploadIds.length > 0
    ) {
      invalid("Send-after-ordering Bundle components cannot contain photo selections.");
    }
    return Object.freeze({
      componentKey: component.componentKey,
      photoSubmissionMethod: component.photoSubmissionMethod,
      designText: component.designText,
      notes: component.notes,
      uploadReferences,
    });
  }

  if (component.photoSubmissionMethod !== "upload") {
    invalid("The Banner Bundle photo submission method is invalid.");
  }
  if (uploadReferences.length === 0) {
    invalid("Upload-now Bundle components require at least one upload reference.");
  }

  const mainPhotoUploadId = component.mainPhotoUploadId ?? uploadReferences[0];
  if (!uploadReferences.includes(mainPhotoUploadId)) {
    invalid("Choose one uploaded Bundle photo as the main photo.");
  }
  if (extraBackgroundRemovalUploadIds.some(
    (uploadId) => uploadId === mainPhotoUploadId || !uploadReferences.includes(uploadId),
  )) {
    invalid("Bundle background removal selections must be distinct non-main uploads.");
  }

  return Object.freeze({
    componentKey: component.componentKey,
    photoSubmissionMethod: component.photoSubmissionMethod,
    designText: component.designText,
    notes: component.notes,
    uploadReferences,
    mainPhotoUploadId,
    ...(extraBackgroundRemovalUploadIds.length > 0
      ? { extraBackgroundRemovalUploadIds }
      : {}),
  });
}

export function validateBannerBundleComponents(
  value: readonly BannerBundleComponentCustomization[],
): readonly BannerBundleComponentCustomization[] {
  if (!Array.isArray(value) || value.length !== 2) {
    invalid("A Banner Bundle requires exactly two component customisations.");
  }
  const keys = value.map((component) => component.componentKey);
  if (
    new Set(keys).size !== 2 ||
    !keys.includes("roll-up") ||
    !keys.includes("wall-banner")
  ) {
    invalid("A Banner Bundle requires one Roll-Up and one Wall Banner customisation.");
  }

  const result = Object.freeze(value.map(freezeComponent));
  const uploads = result.flatMap((component) => component.uploadReferences);
  if (new Set(uploads).size !== uploads.length) {
    invalid("Upload references cannot be shared between Banner Bundle components.");
  }
  return result;
}

export function getBannerBundleCounts(
  value: readonly BannerBundleComponentCustomization[],
): Readonly<{
  rollUpExtraPhotos: number;
  wallBannerExtraPhotos: number;
  rollUpBackgroundRemovals: number;
  wallBannerBackgroundRemovals: number;
}> {
  const components = validateBannerBundleComponents(value);
  const rollUp = components.find((component) => component.componentKey === "roll-up")!;
  const wallBanner = components.find((component) => component.componentKey === "wall-banner")!;
  return Object.freeze({
    rollUpExtraPhotos: Math.max(0, rollUp.uploadReferences.length - 5),
    wallBannerExtraPhotos: Math.max(0, wallBanner.uploadReferences.length - 5),
    rollUpBackgroundRemovals: rollUp.extraBackgroundRemovalUploadIds?.length ?? 0,
    wallBannerBackgroundRemovals:
      wallBanner.extraBackgroundRemovalUploadIds?.length ?? 0,
  });
}

export function flattenBannerBundleUploadReferences(
  value: readonly BannerBundleComponentCustomization[],
): readonly string[] {
  const components = validateBannerBundleComponents(value);
  return Object.freeze(components.flatMap((component) => component.uploadReferences));
}
