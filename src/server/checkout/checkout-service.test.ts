import { describe, expect, it, vi } from "vitest";
import type { CheckoutStateRepository } from "./checkout-repository";
import { createCheckoutService, InvalidCheckoutStateError } from "./checkout-service";
import { ShippingUnavailableError } from "@/server/shipping/shipping-service";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import { synchronizeNewZealandPriceBook } from "@/domain/catalogue/market-price-book";

const sessionId = "10000000-0000-4000-8000-000000000001";
const now = new Date("2026-08-02T12:00:00.000Z");
const billingAddress = {
  country: "NZ",
  fullName: " Aroha Ngata ",
  building: " Unit 4 ",
  street: " 12 Queen Street ",
  suburb: " Auckland Central ",
  region: " Auckland ",
  postcode: "1010",
  phone: "021 123 4567",
  email: "aroha@example.test",
};
const australianAddress = {
  country: "AU",
  fullName: "Mia Chen",
  building: "Level 2",
  street: "55 George Street",
  suburb: "Sydney",
  region: "NSW",
  postcode: "2000",
  phone: "0412 345 678",
  email: "mia@example.test",
};

function cart(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    items: [{
      clientItemId: "00000000-0000-4000-8000-000000000010",
      productKey: "photo-print-canvas",
      sizeKey: "a4",
      orientation: "landscape",
      peoplePets: 0,
      photoSubmissionMethod: "later",
      designText: "Family portrait",
      notes: "Warm colours",
      neededDate: "2026-08-10",
      urgentServiceConfirmed: false,
      quantity: 1,
      uploadReferences: [],
      browserPrice: 1,
      ...overrides,
    }],
  };
}

function repository(
  overrides: Partial<CheckoutStateRepository> = {},
): CheckoutStateRepository {
  return {
    findActiveSessionByTokenDigest: vi.fn(),
    createSession: vi.fn(),
    deleteEmptySession: vi.fn(),
    createUpload: vi.fn(),
    findOwnedUploadIds: vi.fn().mockResolvedValue([]),
    saveCheckoutState: vi.fn().mockImplementation(async (id, input) => ({
      id,
      customerId: null,
      version: 2,
      selectedShippingQuoteId: null,
      expiresAt: new Date("2026-09-01T00:00:00.000Z"),
      ...input,
    })),
    getCheckoutState: vi.fn().mockResolvedValue(null),
    clearSelectedShippingQuote: vi.fn().mockResolvedValue(true),
    persistAndSelectShippingQuote: vi.fn().mockResolvedValue({
      id: "20000000-0000-4000-8000-000000000001",
    }),
    ...overrides,
  };
}

function shippingService() {
  return {
    pickup: vi.fn().mockResolvedValue({
      method: "pickup",
      serviceCode: "pickup",
      serviceName: "Pickup",
      amountExGstCents: 0,
      gstCents: 0,
      amountInclGstCents: 0,
      currency: "NZD",
      provenance: "internal",
      isTest: false,
    }),
    quotePost: vi.fn().mockResolvedValue({
      requestDigest: "d".repeat(64),
      quote: {
        provider: "local-test",
        serviceCode: "test-post-nz",
        serviceName: "Test Post — not a live carrier rate",
        amountExGstCents: 2_000,
        gstCents: 300,
        amountInclGstCents: 2_300,
        currency: "NZD",
        providerReference: "test-ref",
        expiresAt: new Date("2026-08-02T12:15:00.000Z"),
        rawResponseHash: "a".repeat(64),
        isTest: true,
      },
      option: {
        method: "post",
        serviceCode: "test-post-nz",
        serviceName: "Test Post — not a live carrier rate",
        amountExGstCents: 2_000,
        gstCents: 300,
        amountInclGstCents: 2_300,
        currency: "NZD",
        provenance: "local-test",
        isTest: true,
        expiresAt: new Date("2026-08-02T12:15:00.000Z"),
      },
    }),
  };
}

describe("checkout service", () => {
  it("loads the current registry immediately before authoritative repricing", async () => {
    const registry = structuredClone(defaultProductRegistry);
    registry.products[0].configuration.sizes[0].priceExGstCents = 7_100;
    synchronizeNewZealandPriceBook(registry);
    const current = vi.fn().mockResolvedValue({ revision: 2, registry });
    const service = createCheckoutService({
      repository: repository(),
      shippingService: shippingService(),
      productRegistryService: { current },
      now: () => now,
    });

    const state = await service.updateSession(sessionId, {
      cart: cart(),
      billingAddress,
      deliveryMethod: "post",
    });

    expect(current).toHaveBeenCalledOnce();
    expect(state.cartSnapshot?.totalInclGstCents).toBe(8_165);
    expect(state.cartSnapshot?.priceBookRevision).toBe(2);
  });

  it("resolves gallery metadata on the server and persists the trusted snapshot", async () => {
    const designId = "a".repeat(64);
    const resolve = vi.fn().mockResolvedValue({
      id: designId,
      title: "Family at sunset",
      contentHash: "b".repeat(64),
      productSlug: "photo-print-canvas",
      imageUrl: `/gallery-images/${designId}?v=${"b".repeat(64)}`,
    });
    const service = createCheckoutService({
      repository: repository(),
      shippingService: shippingService(),
      gallerySelectionService: { resolve },
      now: () => now,
    });

    const state = await service.updateSession(sessionId, {
      cart: cart({ galleryDesignId: designId }),
      billingAddress,
      deliveryMethod: "post",
    });

    expect(resolve).toHaveBeenCalledWith(designId, "photo-print-canvas");
    expect(state.cartSnapshot?.items[0].galleryDesign).toMatchObject({
      id: designId,
      title: "Family at sunset",
      contentHash: "b".repeat(64),
    });
  });
  it("normalizes NZ addresses, reprices canonical cart and persists a versioned snapshot", async () => {
    const repo = repository();
    const service = createCheckoutService({
      repository: repo,
      shippingService: shippingService(),
      now: () => now,
    });

    const state = await service.updateSession(sessionId, {
      cart: cart(),
      billingAddress,
      useDifferentDeliveryAddress: false,
      deliveryAddress: australianAddress,
      deliveryMethod: "post",
    });

    expect(state.cartSnapshot).toMatchObject({
      totalInclGstCents: 7_475,
      cartDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(state.billingAddress).toMatchObject({
      country: "NZ",
      fullName: "Aroha Ngata",
      phone: "+64211234567",
    });
    expect(state.deliveryAddress).toEqual(state.billingAddress);
    expect(state.deliveryMethod).toBe("post");
    expect(state.selectedShippingQuoteId).toBeNull();
    expect(repo.saveCheckoutState).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({ cartDigest: state.cartSnapshot!.cartDigest }),
    );
  });

  it("normalizes an explicit Australian delivery address", async () => {
    const service = createCheckoutService({
      repository: repository(),
      shippingService: shippingService(),
      now: () => now,
    });
    const state = await service.updateSession(sessionId, {
      cart: cart(),
      billingAddress,
      useDifferentDeliveryAddress: true,
      deliveryAddress: australianAddress,
      deliveryMethod: "post",
    });
    expect(state.deliveryAddress).toMatchObject({
      country: "AU",
      region: "NSW",
      phone: "+61412345678",
    });
  });

  it("rejects an upload reference not owned by the checkout session", async () => {
    const uploadId = "30000000-0000-4000-8000-000000000001";
    const repo = repository({ findOwnedUploadIds: vi.fn().mockResolvedValue([]) });
    const service = createCheckoutService({
      repository: repo,
      shippingService: shippingService(),
      now: () => now,
    });
    await expect(service.updateSession(sessionId, {
      cart: cart({ photoSubmissionMethod: "upload", uploadReferences: [uploadId] }),
      billingAddress,
      useDifferentDeliveryAddress: false,
      deliveryMethod: "post",
    })).rejects.toThrow("do not belong");
    expect(repo.saveCheckoutState).not.toHaveBeenCalled();
  });

  it("selects explicit internal Pickup and clears any Post quote", async () => {
    const repo = repository({
      getCheckoutState: vi.fn().mockResolvedValue({
        id: sessionId,
        version: 3,
        cartDigest: "cart",
        cartSnapshot: { cartDigest: "cart" },
        deliveryAddress: billingAddress,
        deliveryMethod: "pickup",
      }),
    });
    const shipping = shippingService();
    const service = createCheckoutService({ repository: repo, shippingService: shipping });

    await expect(service.quoteShipping(sessionId)).resolves.toMatchObject({
      selectedQuoteId: null,
      option: { method: "pickup", amountInclGstCents: 0 },
    });
    expect(repo.clearSelectedShippingQuote).toHaveBeenCalledWith(sessionId, 3);
    expect(shipping.quotePost).not.toHaveBeenCalled();
  });

  it("persists and selects a positive current Post quote with its request digest", async () => {
    const state = {
      id: sessionId,
      version: 4,
      cartDigest: "cart",
      cartSnapshot: { cartDigest: "cart" },
      deliveryAddress: billingAddress,
      deliveryMethod: "post",
    };
    const repo = repository({ getCheckoutState: vi.fn().mockResolvedValue(state) });
    const shipping = shippingService();
    const service = createCheckoutService({ repository: repo, shippingService: shipping });

    await expect(service.quoteShipping(sessionId)).resolves.toMatchObject({
      selectedQuoteId: "20000000-0000-4000-8000-000000000001",
      option: { method: "post", provenance: "local-test", isTest: true },
    });
    expect(repo.persistAndSelectShippingQuote).toHaveBeenCalledWith({
      sessionId,
      expectedVersion: 4,
      requestDigest: "d".repeat(64),
      quote: expect.objectContaining({ amountInclGstCents: 2_300 }),
    });
  });

  it("never persists guessed shipping after provider failure", async () => {
    const repo = repository({
      getCheckoutState: vi.fn().mockResolvedValue({
        id: sessionId,
        version: 4,
        cartDigest: "cart",
        cartSnapshot: { cartDigest: "cart" },
        deliveryAddress: billingAddress,
        deliveryMethod: "post",
      }),
    });
    const shipping = shippingService();
    shipping.quotePost.mockRejectedValue(new ShippingUnavailableError());
    const service = createCheckoutService({ repository: repo, shippingService: shipping });

    await expect(service.quoteShipping(sessionId)).rejects.toBeInstanceOf(
      ShippingUnavailableError,
    );
    expect(repo.persistAndSelectShippingQuote).not.toHaveBeenCalled();
  });

  it("rejects quoting an incomplete checkout session", async () => {
    const service = createCheckoutService({
      repository: repository(),
      shippingService: shippingService(),
    });
    await expect(service.quoteShipping(sessionId)).rejects.toBeInstanceOf(
      InvalidCheckoutStateError,
    );
  });

  it("rejects a completed checkout before calling a shipping provider", async () => {
    const repo = repository({
      getCheckoutState: vi.fn().mockResolvedValue({
        id: sessionId,
        version: 4,
        completedAt: new Date("2026-08-02T12:00:00.000Z"),
        cartDigest: "cart",
        cartSnapshot: { cartDigest: "cart" },
        deliveryAddress: billingAddress,
        deliveryMethod: "post",
      }),
    });
    const shipping = shippingService();
    const service = createCheckoutService({ repository: repo, shippingService: shipping });

    await expect(service.quoteShipping(sessionId)).rejects.toBeInstanceOf(
      InvalidCheckoutStateError,
    );
    expect(shipping.quotePost).not.toHaveBeenCalled();
  });
});
