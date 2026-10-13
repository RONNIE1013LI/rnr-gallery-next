import { SuppliesSchemaPendingError } from "./errors";
import { beforeEach, expect, it, vi } from "vitest";
import type { SuppliesCatalogue, SupplyProduct } from "@/domain/supplies/types";
const mocks = vi.hoisted(() => ({ load: vi.fn(), purchase: vi.fn(), recover: vi.fn(async () => 0) }));
vi.mock("./catalogue", () => ({ loadSuppliesCatalogue: mocks.load, getPurchasableSupply: mocks.purchase }));
vi.mock("./reservation-expiry", () => ({ releaseAbandonedSupplyReservations: mocks.recover }));
import { getSupplyPurchaseService } from "./purchase-runtime";
const product: SupplyProduct = { id: "one", categoryId: "category", title: "Synthetic", slug: "synthetic", sku: "TEST", shortDescription: "", description: "", status: "published", priceCents: 1150, salePriceCents: null, available: true, trackInventory: false, stockQuantity: null, weightGrams: 1, packedLengthMm: 1, packedWidthMm: 1, packedHeightMm: 1, pickupAllowed: true, shippingAllowed: true, seoTitle: "", seoDescription: "", sortOrder: 0, featured: false, variants: [], images: [] };
const catalogue: SuppliesCatalogue = { settings: { enabled: true, updatedAt: null, updatedBy: null }, categories: [{ id: "category", name: "Synthetic", slug: "synthetic", description: "", sortOrder: 0, visible: true, archived: false, image: null }], products: [product, { ...product, id: "two", sku: "TEST2", slug: "synthetic-two" }] };
beforeEach(() => { vi.clearAllMocks(); mocks.load.mockResolvedValue(catalogue); mocks.purchase.mockResolvedValue({ ...product, product, variant: null, unitPriceCents: 1150, variantLabel: null }); });
it("loads one fresh catalogue and runs bounded recovery once for several lines in a request", async () => {
  const service = getSupplyPurchaseService();
  await Promise.all([service.resolve("one"), service.resolve("two")]);
  expect(mocks.recover).toHaveBeenCalledTimes(1);
  expect(mocks.load).toHaveBeenCalledTimes(1);
});
it("a new request/transaction factory reloads publication and price instead of reusing old authority", async () => {
  await getSupplyPurchaseService().resolve("one");
  mocks.load.mockResolvedValue({ ...catalogue, settings: { ...catalogue.settings, enabled: false } });
  await expect(getSupplyPurchaseService().resolve("one")).rejects.toThrow(/unavailable/);
  expect(mocks.load).toHaveBeenCalledTimes(2);
});

it("maps absent database configuration/schema to checkout unavailable without a database initialization error", async () => {
  mocks.load.mockRejectedValue(new SuppliesSchemaPendingError());
  await expect(getSupplyPurchaseService().resolve("one")).rejects.toMatchObject({ name: "InvalidCheckoutCartError", message: "This supply is unavailable." });
});
