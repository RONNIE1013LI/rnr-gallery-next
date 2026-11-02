import { z } from "zod";
import { calculateCartTotals, getCartDisplayMarket } from "@/domain/cart/cart";
import type { Cart } from "@/domain/cart/types";

export const cartSnapshotItemSchema = z.object({
  productKey: z.string().min(1).max(100),
  productTitle: z.string().min(1).max(160),
  sizeLabel: z.string().max(100),
  peoplePets: z.number().int().min(0).max(999).nullable(),
  quantity: z.number().int().min(1).max(999),
  unitPriceInclGstCents: z.number().int().min(0).max(100_000_000),
}).strict();

const cartSnapshotBaseSchema = z.object({
  version: z.literal(1),
  eventId: z.uuid(),
  stage: z.enum(["cart", "checkout"]),
  currency: z.enum(["NZD", "AUD"]),
  totalInclGstCents: z.number().int().min(0).max(100_000_000),
  items: z.array(cartSnapshotItemSchema).max(50),
}).strict();

export const cartSnapshotSchema = cartSnapshotBaseSchema.superRefine((value, context) => {
  const actual = value.items.reduce((sum, item) =>
    sum + item.quantity * item.unitPriceInclGstCents, 0);
  if (!Number.isSafeInteger(actual) || actual !== value.totalInclGstCents) {
    context.addIssue({ code: "custom", message: "Cart total does not match its items." });
  }
});

export type CartSnapshot = z.infer<typeof cartSnapshotSchema>;
export type CartSnapshotItem = z.infer<typeof cartSnapshotItemSchema>;
export type CartSnapshotStage = CartSnapshot["stage"];

/** Allowlisted product metadata only. Never submit photos, free-text, upload IDs or addresses. */
export function cartSnapshotPayload(cart: Cart, currencyFallback?: "NZD" | "AUD") {
  if (cart.items.length > 50) return null;
  const currency = cart.items.length === 0 ? (currencyFallback ?? "NZD") : getCartDisplayMarket(cart)?.currency;
  if (currency !== "AUD" && currency !== "NZD") return null;
  const items = cart.items.map((item) => ({
    productKey: item.productKey,
    productTitle: item.productTitle,
    sizeLabel: item.sizeLabel,
    peoplePets: item.kind === "supply" ? null : item.peoplePets,
    quantity: item.quantity,
    unitPriceInclGstCents: item.price.totalInclGstCents,
  }));
  const totalInclGstCents = calculateCartTotals(cart).totalInclGstCents;
  const parsed = cartSnapshotBaseSchema.omit({ eventId: true, stage: true })
    .safeParse({ version: 1, currency, items, totalInclGstCents });
  return parsed.success ? parsed.data : null;
}
