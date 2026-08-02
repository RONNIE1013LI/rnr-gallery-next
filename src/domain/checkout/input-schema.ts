import { z } from "zod";
import type { CanonicalCheckoutCartInput } from "./types";

const checkoutItemInputSchema = z.object({
  clientItemId: z.uuid(),
  productKey: z.string().trim().min(1).max(100),
  sizeKey: z.string().trim().min(1).max(100),
  orientation: z.enum(["landscape", "portrait"]).optional(),
  peoplePets: z.number().int().nonnegative(),
  photoSubmissionMethod: z.enum(["upload", "later"]),
  designText: z.string().max(5_000),
  notes: z.string().max(5_000),
  neededDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  urgentServiceConfirmed: z.boolean().optional(),
  quantity: z.number().int().min(1).max(5),
  uploadReferences: z.array(z.uuid()).max(20),
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
