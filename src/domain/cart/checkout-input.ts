import type { Cart } from "./types";

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
      uploadReferences: [...item.uploadReferences],
      ...(item.mainPhotoUploadId ? { mainPhotoUploadId: item.mainPhotoUploadId } : {}),
      ...(item.extraBackgroundRemovalUploadIds
        ? { extraBackgroundRemovalUploadIds: [...item.extraBackgroundRemovalUploadIds] }
        : {}),
    })),
  };
}
