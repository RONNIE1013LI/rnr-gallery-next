import { z } from "zod";

export class SuppliesValidationError extends Error {
  constructor(message: string, public readonly status = 422) { super(message); this.name = "SuppliesValidationError"; }
}

const slug = z.string().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase words separated by hyphens");
const cents = z.number().int().min(0).max(100_000_000);
const packaging = {
  weightGrams: z.number().int().positive().max(1_000_000).nullable(),
  packedLengthMm: z.number().int().positive().max(20_000).nullable(),
  packedWidthMm: z.number().int().positive().max(20_000).nullable(),
  packedHeightMm: z.number().int().positive().max(20_000).nullable(),
};
const inventory = {
  trackInventory: z.boolean(), stockQuantity: z.number().int().min(0).max(1_000_000).nullable(), available: z.boolean(),
  expectedStockQuantity: z.number().int().min(0).max(1_000_000).nullable().optional(),
};
const variant = z.object({
  id: z.uuid().optional(), sku: z.string().trim().min(1).max(100), label: z.string().trim().min(1).max(160),
  options: z.record(z.string().min(1).max(60), z.string().min(1).max(100)), priceCents: cents, salePriceCents: cents.nullable(),
  active: z.boolean(), sortOrder: z.number().int().min(0).max(100_000), ...packaging, ...inventory,
}).strict();
export const categoryInputSchema = z.object({
  name: z.string().trim().min(1).max(160), slug, description: z.string().max(4000),
  sortOrder: z.number().int().min(0).max(100_000), visible: z.boolean(), archived: z.boolean(),
}).strict();
export const productInputSchema = z.object({
  categoryId: z.uuid(), title: z.string().trim().min(1).max(200), slug, sku: z.string().trim().min(1).max(100),
  shortDescription: z.string().max(600), description: z.string().max(30_000), status: z.enum(["draft", "published", "archived"]),
  priceCents: cents, salePriceCents: cents.nullable(), ...packaging, ...inventory,
  pickupAllowed: z.boolean(), shippingAllowed: z.boolean(), seoTitle: z.string().max(200), seoDescription: z.string().max(400),
  sortOrder: z.number().int().min(0).max(100_000), featured: z.boolean(), variants: z.array(variant).max(100),
}).strict();

export type SupplyCategoryInput = z.infer<typeof categoryInputSchema>;
export type SupplyProductInput = z.infer<typeof productInputSchema>;

export function parseSupplyCategoryInput(input: unknown): SupplyCategoryInput {
  const result = categoryInputSchema.safeParse(input);
  if (!result.success) throw new SuppliesValidationError(result.error.issues[0]?.message ?? "Invalid category");
  return result.data;
}

export function parseSupplyProductInput(input: unknown): SupplyProductInput {
  const result = productInputSchema.safeParse(input);
  if (!result.success) throw new SuppliesValidationError(result.error.issues[0]?.message ?? "Invalid product");
  const product = result.data;
  const skus = new Set<string>([product.sku.toLowerCase()]);
  const ids = new Set<string>();
  for (const selection of [product, ...product.variants]) {
    if (selection.salePriceCents !== null && (selection.salePriceCents < 1 || selection.salePriceCents >= selection.priceCents)) {
      throw new SuppliesValidationError("Sale price must be positive and below retail price");
    }
    if (selection.trackInventory && selection.stockQuantity === null) throw new SuppliesValidationError("Tracked stock needs an inventory count");
  }
  for (const variant of product.variants) {
    if (skus.has(variant.sku.toLowerCase())) throw new SuppliesValidationError("Product and variant SKUs must be unique");
    skus.add(variant.sku.toLowerCase());
    if (variant.id && ids.has(variant.id)) throw new SuppliesValidationError("Variant IDs must be unique");
    if (variant.id) ids.add(variant.id);
  }
  if (product.status === "published") {
    if (!product.pickupAllowed && !product.shippingAllowed) throw new SuppliesValidationError("Published products need pickup or shipping");
    const selections = product.variants.length ? product.variants.filter((item) => item.active) : [product];
    if (!selections.length) throw new SuppliesValidationError("Publish at least one active variant");
    for (const selection of selections) {
      if (selection.priceCents < 1) throw new SuppliesValidationError("Published products need a positive price");
      if (product.shippingAllowed && Object.keys(packaging).some((key) => (selection[key as keyof typeof packaging] ?? product[key as keyof typeof packaging]) === null)) {
        throw new SuppliesValidationError("Shipping needs measured weight and packed dimensions");
      }
    }
  }
  return product;
}
