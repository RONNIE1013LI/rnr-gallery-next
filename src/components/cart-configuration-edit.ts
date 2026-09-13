import type { Cart, CartItem } from "@/domain/cart/types";
import type { ProductConfigurationSchema } from "@/domain/configuration/types";
import type { SourcePhotoCustomisationValue } from "./source-photo-customisation";

export function editableCartItem(cart: Cart, id: string, productSlug: string, schema: ProductConfigurationSchema): CartItem | undefined {
  const matches = cart.items.filter((item) => item.id === id);
  const item = matches[0];
  if (matches.length !== 1 || !item || item.productKey !== schema.productKey || item.productSlug !== productSlug
    || !schema.sizes.some((size) => size.key === item.sizeKey)
    || (item.productionWorkingDays !== undefined && (!Number.isInteger(item.productionWorkingDays) || item.productionWorkingDays < 1))
    || (item.eventDate !== undefined && typeof item.eventDate !== "string")
    || (item.mainPhotoUploadId !== undefined && !item.uploadReferences.includes(item.mainPhotoUploadId))
    || (item.extraBackgroundRemovalUploadIds !== undefined && (!Array.isArray(item.extraBackgroundRemovalUploadIds)
      || !item.extraBackgroundRemovalUploadIds.every((id) => typeof id === "string" && item.uploadReferences.includes(id))))) return undefined;
  return item;
}

export function needsProductionServiceReview(item: CartItem): boolean {
  return item.productionWorkingDays === undefined
    ? item.urgentServiceConfirmed === true || Boolean(item.urgentFeeInclGstCents)
    : ![1, 2, 3].includes(item.productionWorkingDays);
}

export function restoreCartPhotos(value: Pick<CartItem, "photoSubmissionMethod" | "designText" | "notes" | "uploadReferences" | "mainPhotoUploadId" | "extraBackgroundRemovalUploadIds">): SourcePhotoCustomisationValue {
  return {
    photoSubmissionMethod: value.photoSubmissionMethod,
    designText: value.designText,
    notes: value.notes,
    uploadedFiles: value.uploadReferences.map((id, index) => ({ id, originalName: `Saved photo ${index + 1}` })),
    mainPhotoUploadId: value.mainPhotoUploadId,
    extraBackgroundRemovalUploadIds: value.extraBackgroundRemovalUploadIds ?? [],
  };
}

export function replaceConfiguredCartItem(cart: Cart, original: CartItem, replacement: CartItem): Cart {
  const matches = cart.items.filter((item) => item.id === original.id);
  const current = matches[0];
  if (matches.length !== 1 || !current || replacement.productKey !== original.productKey
    || JSON.stringify({ ...current, quantity: original.quantity }) !== JSON.stringify(original)) {
    throw new Error("This cart item changed while you were editing. Return to your cart and open it again.");
  }
  return { version: 1, items: cart.items.map((item) => item.id === original.id
    ? { ...replacement, id: original.id, quantity: item.quantity }
    : item) };
}
