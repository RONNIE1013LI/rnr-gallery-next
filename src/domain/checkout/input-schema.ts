import { z } from "zod";
import type { CanonicalCheckoutCartInput } from "./types";
import { MAX_SOURCE_PHOTOS_PER_ITEM } from "@/domain/configuration/types";
import { MAX_BANNER_BUNDLE_SOURCE_PHOTOS } from "@/domain/bundles/banner-bundle";

// Defensive boundaries that are independent from each product's included quantity.
export const MAX_PEOPLE_PETS_PER_ITEM = 20;
export const MAX_CHECKOUT_TEXT_LENGTH = 5_000;

const bannerBundleComponentSchema = z.object({
  componentKey: z.enum(["roll-up", "wall-banner"]),
  photoSubmissionMethod: z.enum(["upload", "later"]),
  designText: z.string().max(MAX_CHECKOUT_TEXT_LENGTH),
  notes: z.string().max(MAX_CHECKOUT_TEXT_LENGTH),
  uploadReferences: z.array(z.uuid()).max(MAX_SOURCE_PHOTOS_PER_ITEM),
  mainPhotoUploadId: z.uuid().optional(),
  extraBackgroundRemovalUploadIds: z
    .array(z.uuid())
    .max(MAX_SOURCE_PHOTOS_PER_ITEM - 1)
    .optional(),
});

const checkoutItemInputSchema = z.object({
  clientItemId: z.uuid(),
  productKey: z.string().trim().min(1).max(100),
  galleryDesignId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  sizeKey: z.string().trim().min(1).max(100),
  orientation: z.enum(["landscape", "portrait"]).optional(),
  peoplePets: z.number().int().nonnegative().max(MAX_PEOPLE_PETS_PER_ITEM),
  photoSubmissionMethod: z.enum(["upload", "later"]),
  designText: z.string().max(MAX_CHECKOUT_TEXT_LENGTH),
  notes: z.string().max(MAX_CHECKOUT_TEXT_LENGTH),
  neededDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  urgentServiceConfirmed: z.boolean().optional(),
  quantity: z.number().int().min(1).max(5),
  uploadReferences: z.array(z.uuid()).max(MAX_BANNER_BUNDLE_SOURCE_PHOTOS),
  mainPhotoUploadId: z.uuid().optional(),
  extraBackgroundRemovalUploadIds: z.array(z.uuid()).max(MAX_SOURCE_PHOTOS_PER_ITEM - 1).optional(),
  bundleComponents: z.array(bannerBundleComponentSchema).length(2).optional(),
}).superRefine((item, context) => {
  const maximum = item.productKey === "banner-bundle"
    ? MAX_BANNER_BUNDLE_SOURCE_PHOTOS
    : MAX_SOURCE_PHOTOS_PER_ITEM;
  if (item.uploadReferences.length > maximum) {
    context.addIssue({
      code: "custom",
      path: ["uploadReferences"],
      message: `Choose no more than ${maximum} source photos.`,
    });
  }
});

export const checkoutCartInputSchema = z.object({
  version: z.literal(1),
  items: z.array(checkoutItemInputSchema).min(1).max(50),
});

export function parseCheckoutCartInput(
  value: unknown,
): CanonicalCheckoutCartInput {
  return checkoutCartInputSchema.parse(value);
}
