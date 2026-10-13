import type { PurchasableSupply, SuppliesCatalogue, SupplyProduct } from "./types";

function retainedVariants(product: SupplyProduct) {
  return product.variants.filter((variant) => !("archived" in variant && variant.archived === true));
}

export function publicSuppliesCatalogue(catalogue: SuppliesCatalogue): SuppliesCatalogue | null {
  if (!catalogue.settings.enabled) return null;
  const categories = catalogue.categories.filter((category) => category.visible && !category.archived);
  const categoryIds = new Set(categories.map((category) => category.id));
  return {
    ...catalogue,
    settings: { enabled: true, updatedAt: null, updatedBy: null },
    categories,
    products: catalogue.products.filter((product) => product.status === "published" && categoryIds.has(product.categoryId))
      .map((product) => {
        const retained = retainedVariants(product);
        const variants = retained.filter((variant) => variant.active);
        return { ...product, variants, available: product.available && (!retained.length || variants.length > 0) };
      }),
  };
}

export function validateSupplyPurchase(
  catalogue: SuppliesCatalogue,
  productId: string,
  variantId?: string | null,
  options: { allowReservedStock?: boolean } = {},
): PurchasableSupply | null {
  const publicCatalogue = publicSuppliesCatalogue(catalogue);
  const product = publicCatalogue?.products.find((candidate) => candidate.id === productId);
  if (!product || !product.available) return null;
  // Inactive variations still make this a variant product; never sell its fallback price.
  const sourceProduct = catalogue.products.find((candidate) => candidate.id === productId);
  const hasVariants = sourceProduct ? retainedVariants(sourceProduct).length > 0 : false;
  const variant = variantId ? product.variants.find((candidate) => candidate.id === variantId) : null;
  if ((hasVariants && !variant) || (variantId && !variant)) return null;
  const selection = variant ?? product;
  if (!selection.available || (!options.allowReservedStock && selection.trackInventory && (selection.stockQuantity ?? 0) < 1)) return null;
  const unitPriceCents = selection.salePriceCents ?? selection.priceCents;
  if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 1) return null;
  return {
    product, variant: variant ?? null, unitPriceCents,
    sku: selection.sku, title: product.title, variantLabel: variant?.label ?? null,
    trackInventory: selection.trackInventory, stockQuantity: selection.stockQuantity, available: selection.available,
    weightGrams: selection.weightGrams ?? product.weightGrams,
    packedLengthMm: selection.packedLengthMm ?? product.packedLengthMm,
    packedWidthMm: selection.packedWidthMm ?? product.packedWidthMm,
    packedHeightMm: selection.packedHeightMm ?? product.packedHeightMm,
    pickupAllowed: product.pickupAllowed, shippingAllowed: product.shippingAllowed,
  };
}
