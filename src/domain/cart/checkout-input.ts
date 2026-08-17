import type { Cart } from "./types";
import {
  validateBannerBundleComponents,
  type BannerBundleComponentCustomization,
} from "@/domain/bundles/banner-bundle";

function copyBundleComponents(
  components: readonly BannerBundleComponentCustomization[],
) {
  validateBannerBundleComponents(components);
  return Object.freeze(components.map((component) => Object.freeze({
    ...component,
    uploadReferences: Object.freeze([...component.uploadReferences]),
    ...(component.extraBackgroundRemovalUploadIds
      ? {
          extraBackgroundRemovalUploadIds: Object.freeze([
            ...component.extraBackgroundRemovalUploadIds,
          ]),
        }
      : {}),
  })));
}

export function cartToCheckoutInput(cart: Cart) {
  return {
    version: 1 as const,
    items: cart.items.map((item) => ({
      clientItemId: item.id,
      productKey: item.productKey,
      sizeKey: item.sizeKey,
      ...(item.galleryDesignId ? { galleryDesignId: item.galleryDesignId } : {}),
      ...(item.orientation ? { orientation: item.orientation } : {}),
      peoplePets: item.peoplePets,
      photoSubmissionMethod: item.photoSubmissionMethod,
      designText: item.designText,
      notes: item.notes,
      neededDate: item.neededDate,
      urgentServiceConfirmed: item.urgentServiceConfirmed === true,
      quantity: item.quantity,
      uploadReferences: Object.freeze([...item.uploadReferences]),
      ...(item.mainPhotoUploadId ? { mainPhotoUploadId: item.mainPhotoUploadId } : {}),
      ...(item.extraBackgroundRemovalUploadIds
        ? {
            extraBackgroundRemovalUploadIds: Object.freeze([
              ...item.extraBackgroundRemovalUploadIds,
            ]),
          }
        : {}),
      ...(item.bundleComponents
        ? {
            bundleComponents: copyBundleComponents(item.bundleComponents),
          }
        : {}),
    })),
  };
}
