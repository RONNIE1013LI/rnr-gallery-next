import { SuppliesSchemaPendingError } from "./errors";
import { validateSupplyPurchase } from "@/domain/supplies/catalogue-policy";
import type { SuppliesCatalogue } from "@/domain/supplies/types";
import { releaseAbandonedSupplyReservations } from "./reservation-expiry";
import { loadSuppliesCatalogue, type SuppliesReadDatabase } from "./catalogue";
import type { SuppliesPurchaseService } from "@/domain/checkout/types";
import { InvalidCheckoutCartError } from "@/domain/checkout/types";
export { getPurchasableSupply, loadSuppliesCatalogue } from "./catalogue";
export { validateSupplyPurchase } from "@/domain/supplies/catalogue-policy";

/** Fresh transactional reads only. Never use the public display cache for a purchase. */
export function getSupplyPurchaseService(database?: SuppliesReadDatabase, allowReservedStock = false): SuppliesPurchaseService {
  // This factory is created per request or final locked transaction; never keep it in module state.
  let catalogue: Promise<SuppliesCatalogue> | undefined;
  const current = () => catalogue ??= (async () => {
    if (!database) await releaseAbandonedSupplyReservations();
    return loadSuppliesCatalogue(database);
  })();
  return { async resolve(productId, variantId) {
    const catalogue = await current().catch((error) => {
      if (error instanceof SuppliesSchemaPendingError) throw new InvalidCheckoutCartError("This supply is unavailable.", { cause: error });
      throw error;
    });
    const supply = validateSupplyPurchase(catalogue, productId, variantId, { allowReservedStock });
    if (!supply) throw new InvalidCheckoutCartError("This supply is unavailable.");
    return Object.freeze({ productId: supply.product.id, variantId: supply.variant?.id ?? null,
      title: supply.title, slug: supply.product.slug, sku: supply.sku, variantLabel: supply.variantLabel ?? "Standard supply",
      unitPriceCents: supply.unitPriceCents, trackInventory: supply.trackInventory, stockQuantity: supply.stockQuantity,
      weightGrams: supply.weightGrams, packedLengthMm: supply.packedLengthMm, packedWidthMm: supply.packedWidthMm,
      packedHeightMm: supply.packedHeightMm, pickupAllowed: supply.pickupAllowed, shippingAllowed: supply.shippingAllowed });
  } };
}
