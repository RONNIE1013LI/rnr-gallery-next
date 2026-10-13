import { describe, expect, it, vi } from "vitest";
import { createCheckoutService } from "./checkout-service";
import type { CheckoutStateRecord, CheckoutStateRepository } from "./checkout-repository";
import { createOrderService } from "@/server/orders/order-service";
import type { OrderRepository } from "@/server/orders/order-repository";
import { createShippingService } from "@/server/shipping/shipping-service";
import { buildWebProductionJobSnapshot } from "@/server/orders/drizzle-order-repository";
import { buildOrderPricingSnapshot } from "@/server/orders/order-pricing-snapshot";
import { repriceCart } from "@/domain/checkout/reprice-cart";
import { normalizeAddress } from "@/domain/address/schema";
import type { SupplyPurchaseSnapshot } from "@/domain/checkout/types";

const now = new Date("2026-10-13T00:00:00Z");
const productId = "00000000-0000-4000-8000-000000000002";
const supply = { kind: "supply", clientItemId: "00000000-0000-4000-8000-000000000001", supplyProductId: productId, quantity: 12 };
const custom = { clientItemId: "00000000-0000-4000-8000-000000000003", productKey: "photo-print-canvas", sizeKey: "a4", orientation: "landscape", peoplePets: 0, photoSubmissionMethod: "later", designText: "Synthetic artwork", notes: "", neededDate: "2026-11-20", quantity: 1, uploadReferences: [] };
const purchase: SupplyPurchaseSnapshot = { productId, variantId: null, title: "Synthetic supply", slug: "synthetic-supply", sku: "SYNTHETIC", variantLabel: "Standard", unitPriceCents: 1150, trackInventory: true, stockQuantity: 20, weightGrams: 1100, packedLengthMm: 910, packedWidthMm: 130, packedHeightMm: 125, pickupAllowed: true, shippingAllowed: true };
const address = normalizeAddress({ country: "NZ", fullName: "Synthetic Customer", building: "", street: "12 Queen Street", suburb: "Auckland Central", region: "Auckland", postcode: "1010", phone: "0211234567", email: "synthetic@example.test" });
function setup(purchasable = purchase) {
  let state: CheckoutStateRecord | null = null;
  const resolve = vi.fn(async () => purchasable);
  const repository = { saveCheckoutState: vi.fn(async (id, input) => { state = { id, tokenDigest: "synthetic", customerId: null, expiresAt: new Date(now.getTime() + 86400000), version: 1, selectedShippingQuoteId: null, completedAt: null, ...input }; return state; }),
    getCheckoutState: async () => state, findOwnedUploadIds: async () => [], clearSelectedShippingQuote: vi.fn(async () => true) } as unknown as CheckoutStateRepository;
  const shippingService = createShippingService({ provider: null, now: () => now });
  const service = createCheckoutService({ repository, shippingService, suppliesPurchaseService: { resolve }, now: () => now });
  return { service, repository, resolve, state: () => state!, shippingService };
}

describe("fresh supply purchase boundaries", () => {
  it("reprices a mixed cart and preserves custom artwork fields", async () => {
    const fixture = setup();
    const state = await fixture.service.updateSession("session", { cart: { version: 1, items: [supply, custom] }, billingAddress: address, deliveryMethod: "pickup" });
    expect(state.cartSnapshot!.items[0]).toMatchObject({ kind: "supply", quantity: 12, lineTotalInclGstCents: 13800 });
    expect(state.cartSnapshot!.items[0]).not.toHaveProperty("neededDate");
    expect(state.cartSnapshot!.items[1]).toMatchObject({ quantity: 1, neededDate: "2026-11-20", designText: "Synthetic artwork", unitPrice: { totalInclGstCents: 7475 } });
    expect(state.cartSnapshot!.totalInclGstCents).toBe(21275);
  });
  it("rejects a supply that disallows the selected pickup method", async () => {
    const fixture = setup({ ...purchase, pickupAllowed: false });
    await expect(fixture.service.updateSession("session", { cart: { version: 1, items: [supply] }, billingAddress: address, deliveryMethod: "pickup" })).rejects.toThrow(/delivery method/);
    expect(fixture.repository.saveCheckoutState).not.toHaveBeenCalled();
  });
  it("rechecks OFF/publication on shipping mutation after reviewing checkout", async () => {
    const fixture = setup();
    await fixture.service.updateSession("session", { cart: { version: 1, items: [supply] }, billingAddress: address, deliveryMethod: "pickup" });
    fixture.resolve.mockRejectedValue(new Error("Supplies store OFF"));
    await expect(fixture.service.quoteShipping("session")).rejects.toThrow(/OFF/);
    expect(fixture.repository.clearSelectedShippingQuote).not.toHaveBeenCalled();
  });
  it("never loads supplies authority for a custom checkout", async () => {
    const fixture = setup();
    fixture.resolve.mockRejectedValue(new Error("Supplies tables absent"));
    await fixture.service.updateSession("session", { cart: { version: 1, items: [custom] }, billingAddress: address, deliveryMethod: "pickup" });
    expect(fixture.resolve).not.toHaveBeenCalled();
  });
  it("rechecks the store before creating an order from an existing supply snapshot", async () => {
    const fixture = setup();
    await fixture.service.updateSession("session", { cart: { version: 1, items: [supply] }, billingAddress: address, deliveryMethod: "pickup" });
    fixture.resolve.mockRejectedValue(new Error("Supplies store OFF"));
    const repository = { findBySession: async () => null, getCheckoutState: async () => fixture.state(), createAtomicOrder: vi.fn(), findOwnedUploadIds: async () => [] } as unknown as OrderRepository;
    const service = createOrderService({ repository, shippingService: fixture.shippingService, suppliesPurchaseService: { resolve: fixture.resolve }, now: () => now });
    await expect(service.createOrder("session", "idempotency", { checkoutVersion: 1, cartDigest: fixture.state().cartDigest!, shipping: { method: "pickup", serviceCode: "pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, isTest: false } })).rejects.toThrow(/OFF/);
    expect(repository.createAtomicOrder).not.toHaveBeenCalled();
  });
  it("keeps a supply SKU/title/variant in immutable pricing snapshots without custom production", () => {
    const cart = repriceCart({ version: 1, items: [supply] }, { now, supplies: new Map([[productId, purchase]]) });
    const pricing = buildOrderPricingSnapshot(cart, { kind: "pickup" });
    expect(pricing.items[0]).toMatchObject({ kind: "supply", supplySnapshot: { title: "Synthetic supply", sku: "SYNTHETIC", variantLabel: "Standard" }, quantity: 12 });
    expect(buildWebProductionJobSnapshot({ order: { id: "order", orderNumber: "SYNTHETIC" }, cart, billingAddress: address, deliveryAddress: address, deliveryMethod: "pickup", orderItemIds: [], now, paymentStatus: "paid" })).toBeNull();
  });
  it("creates production records only for custom items in a paid mixed cart", () => {
    const cart = repriceCart({ version: 1, items: [supply, custom] }, { now, supplies: new Map([[productId, purchase]]) });
    const production = buildWebProductionJobSnapshot({ order: { id: "order", orderNumber: "SYNTHETIC" }, cart, billingAddress: address, deliveryAddress: address, deliveryMethod: "pickup", orderItemIds: ["custom-item-id"], now, paymentStatus: "paid" });
    expect(production).not.toBeNull();
    expect(production!.items).toHaveLength(1);
    expect(production!.items[0]).toMatchObject({ sourceOrderItemId: "custom-item-id", productTitle: "Photo Print Canvas", designText: "Synthetic artwork" });
    expect(production!.job.neededDate).toBe("2026-11-20");
  });
});
