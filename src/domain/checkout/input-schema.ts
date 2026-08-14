import { z } from "zod";
import type { CanonicalCheckoutCartInput } from "./types";

// Conservative per-artwork boundary matching the current 20-source-photo scale.
export const MAX_PEOPLE_PETS_PER_ITEM = 20;

const checkoutItemInputSchema = z.object({
  clientItemId: z.uuid(),
  productKey: z.string().trim().min(1).max(100),
  galleryDesignId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  sizeKey: z.string().trim().min(1).max(100),
  orientation: z.enum(["landscape", "portrait"]).optional(),
  peoplePets: z.number().int().nonnegative().max(MAX_PEOPLE_PETS_PER_ITEM),
  photoSubmissionMethod: z.enum(["upload", "later"]),
  designText: z.string().max(5_000),
  notes: z.string().max(5_000),
  neededDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  urgentServiceConfirmed: z.boolean().optional(),
  quantity: z.number().int().min(1).max(5),
  uploadReferences: z.array(z.uuid()).max(20),
  mainPhotoUploadId: z.uuid().optional(),
  extraBackgroundRemovalUploadIds: z.array(z.uuid()).max(19).optional(),
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
