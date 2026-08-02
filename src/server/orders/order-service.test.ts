import { describe, expect, it, vi } from "vitest";
import { normalizeAddress } from "@/domain/address/schema";
import { repriceCart } from "@/domain/checkout/reprice-cart";
import type { CheckoutStateRecord } from "@/server/checkout/checkout-repository";
import {
  createOrderService,
  OrderConflictError,
  OrderStateChangedError,
} from "./order-service";
import {
  OrderNumberCollisionError,
  UnclaimableUploadError,
  type OrderRepository,
} from "./order-repository";

const sessionId = "10000000-0000-4000-8000-000000000001";
const key = "20000000-0000-4000-8000-000000000001";
const now = new Date("2026-08-02T12:00:00.000Z");
const address = normalizeAddress({
  country: "NZ", fullName: "Aroha Ngata", building: "",
  street: "12 Queen Street", suburb: "Auckland Central", region: "Auckland",
  postcode: "1010", phone: "021 123 4567", email: "aroha@example.test",
});

function canonicalCart() {
  return {
    version: 1 as const,
    items: [{
      clientItemId: "30000000-0000-4000-8000-000000000001",
      productKey: "photo-print-canvas", sizeKey: "a4", orientation: "landscape" as const,
      peoplePets: 0, photoSubmissionMethod: "later" as const,
      designText: "Family", notes: "", neededDate: "2026-08-10",
      urgentServiceConfirmed: false, quantity: 1, uploadReferences: [],
    }],
  };
}

function state(method: "pickup" | "post" = "pickup"): CheckoutStateRecord {
  const cart = repriceCart(canonicalCart(), { now });
  return {
    id: sessionId,
    tokenDigest: "digest",
    customerId: null,
    expiresAt: new Date("2026-09-01T00:00:00.000Z"),
    completedAt: null,
    version: 2,
    cartDigest: cart.cartDigest,
    cartSnapshot: cart,
    billingAddress: address,
    deliveryAddress: address,
    deliveryMethod: method,
    selectedShippingQuoteId: null,
  };
}

function reviewed(method: "pickup" | "post" = "pickup") {
  const checkout = state(method);
  return { checkoutVersion: checkout.version, cartDigest: checkout.cartDigest!, shipping: method === "pickup" ? { method, serviceCode: "pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, isTest: false } : { method, serviceCode: "post", amountExGstCents: 2_000, gstCents: 300, amountInclGstCents: 2_300, isTest: true } } as const;
}

const existingOrder = {
  id: "40000000-0000-4000-8000-000000000001",
  checkoutSessionId: sessionId,
  idempotencyKey: key,
  orderNumber: "RNR-2026-ABC12345",
  customerId: null,
  customerEmail: "aroha@example.test",
  currency: "NZD" as const,
  totalInclGstCents: 7_475,
  paymentStatus: "awaiting_payment" as const,
};

function repository(overrides: Partial<OrderRepository> = {}): OrderRepository {
  return {
    findSessionByTokenDigest: vi.fn(),
    findBySession: vi.fn().mockResolvedValue(null),
    getCheckoutState: vi.fn().mockResolvedValue(state()),
    findOwnedUploadIds: vi.fn().mockResolvedValue([]),
    createAtomicOrder: vi.fn().mockResolvedValue(existingOrder),
    ...overrides,
  };
}

function shippingService() {
  return {
    pickup: vi.fn().mockResolvedValue({
      method: "pickup", serviceCode: "pickup", serviceName: "Pickup",
      amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0,
      currency: "NZD", provenance: "internal", isTest: false,
    }),
    quotePost: vi.fn().mockResolvedValue({
      requestDigest: "a".repeat(64),
      quote: {
        provider: "local-test", serviceCode: "post", serviceName: "Test Post",
        amountExGstCents: 2_000, gstCents: 300, amountInclGstCents: 2_300,
        currency: "NZD", providerReference: "fresh-ref",
        expiresAt: new Date("2026-08-02T12:15:00.000Z"),
        rawResponseHash: "b".repeat(64), isTest: true,
      },
      option: {},
    }),
  };
}

describe("atomic order service", () => {
  it("returns the same-session same-key order before repricing or quoting", async () => {
    const repo = repository({ findBySession: vi.fn().mockResolvedValue(existingOrder) });
    const shipping = shippingService();
    const service = createOrderService({ repository: repo, shippingService: shipping });

    await expect(service.createOrder(sessionId, key, reviewed())).resolves.toEqual({
      orderId: existingOrder.id,
      orderNumber: "RNR-2026-ABC12345",
      currency: "NZD",
      totalInclGstCents: 7_475,
      paymentStatus: "awaiting_payment",
    });
    expect(repo.getCheckoutState).not.toHaveBeenCalled();
    expect(shipping.quotePost).not.toHaveBeenCalled();
  });

  it("rejects a different key when the session already has an order", async () => {
    const repo = repository({ findBySession: vi.fn().mockResolvedValue(existingOrder) });
    const service = createOrderService({ repository: repo, shippingService: shippingService() });
    await expect(service.createOrder(
      sessionId,
      "20000000-0000-4000-8000-000000000002",
      reviewed(),
    )).rejects.toBeInstanceOf(OrderConflictError);
  });

  it("creates Pickup with exact zero shipping and no provider call", async () => {
    const repo = repository();
    const shipping = shippingService();
    const service = createOrderService({
      repository: repo, shippingService: shipping, now: () => now,
      createOrderNumber: () => "RNR-2026-ABC12345",
    });

    await service.createOrder(sessionId, key, reviewed());

    expect(shipping.quotePost).not.toHaveBeenCalled();
    expect(repo.createAtomicOrder).toHaveBeenCalledWith(expect.objectContaining({
      sessionId,
      idempotencyKey: key,
      orderNumber: "RNR-2026-ABC12345",
      shipping: { kind: "pickup" },
    }));
  });

  it("freshly requotes Post and passes the quote into the transaction", async () => {
    const checkout = state("post");
    const repo = repository({ getCheckoutState: vi.fn().mockResolvedValue(checkout) });
    const shipping = shippingService();
    const service = createOrderService({ repository: repo, shippingService: shipping, now: () => now });

    await service.createOrder(sessionId, key, reviewed("post"));

    expect(shipping.quotePost).toHaveBeenCalledWith(checkout.cartSnapshot, address);
    expect(repo.createAtomicOrder).toHaveBeenCalledWith(expect.objectContaining({
      shipping: expect.objectContaining({
        kind: "post",
        requestDigest: "a".repeat(64),
        quote: expect.objectContaining({ providerReference: "fresh-ref" }),
      }),
    }));
  });

  it("rejects Post when the fresh quote differs from the reviewed quote", async () => {
    const checkout = state("post");
    const repo = repository({ getCheckoutState: vi.fn().mockResolvedValue(checkout) });
    const service = createOrderService({ repository: repo, shippingService: shippingService(), now: () => now });
    const staleReview = reviewed("post");

    await expect(service.createOrder(sessionId, key, {
      ...staleReview,
      shipping: { ...staleReview.shipping, amountExGstCents: 1_900, gstCents: 285, amountInclGstCents: 2_185 },
    })).rejects.toBeInstanceOf(OrderStateChangedError);
    expect(repo.createAtomicOrder).not.toHaveBeenCalled();
  });

  it("captures transaction time after a potentially slow Post quote", async () => {
    const checkout = state("post");
    const repo = repository({ getCheckoutState: vi.fn().mockResolvedValue(checkout) });
    const times = [
      new Date("2026-08-02T12:00:00.000Z"),
      new Date("2026-08-02T12:16:00.000Z"),
    ];
    const service = createOrderService({
      repository: repo,
      shippingService: shippingService(),
      now: () => times.shift()!,
    });

    await service.createOrder(sessionId, key, reviewed("post"));

    expect(repo.createAtomicOrder).toHaveBeenCalledWith(expect.objectContaining({
      now: new Date("2026-08-02T12:16:00.000Z"),
    }));
  });

  it("rejects a stored cart whose canonical current digest has changed", async () => {
    const checkout = state();
    const repo = repository({
      getCheckoutState: vi.fn().mockResolvedValue({
        ...checkout,
        cartDigest: "c".repeat(64),
      }),
    });
    const service = createOrderService({ repository: repo, shippingService: shippingService(), now: () => now });
    await expect(service.createOrder(sessionId, key, reviewed())).rejects.toBeInstanceOf(
      OrderStateChangedError,
    );
    expect(repo.createAtomicOrder).not.toHaveBeenCalled();
  });

  it("retries a non-PII order-number collision without requoting", async () => {
    const repo = repository({
      createAtomicOrder: vi.fn()
        .mockRejectedValueOnce(new OrderNumberCollisionError())
        .mockResolvedValueOnce(existingOrder),
    });
    const numbers = ["RNR-2026-AAAA1111", "RNR-2026-BBBB2222"];
    const service = createOrderService({
      repository: repo, shippingService: shippingService(), now: () => now,
      createOrderNumber: () => numbers.shift()!,
    });

    await service.createOrder(sessionId, key, reviewed());

    expect(repo.createAtomicOrder).toHaveBeenCalledTimes(2);
    expect(repo.createAtomicOrder).toHaveBeenLastCalledWith(expect.objectContaining({
      orderNumber: "RNR-2026-BBBB2222",
    }));
  });

  it("stops after five order-number collisions", async () => {
    const repo = repository({
      createAtomicOrder: vi.fn().mockRejectedValue(new OrderNumberCollisionError()),
    });
    const service = createOrderService({
      repository: repo, shippingService: shippingService(), now: () => now,
      createOrderNumber: () => "RNR-2026-BROKEN0000",
    });

    await expect(service.createOrder(sessionId, key, reviewed())).rejects.toBeInstanceOf(
      OrderNumberCollisionError,
    );
    expect(repo.createAtomicOrder).toHaveBeenCalledTimes(5);
  });

  it("maps an upload claim race to a checkout-changed response", async () => {
    const repo = repository({
      createAtomicOrder: vi.fn().mockRejectedValue(new UnclaimableUploadError()),
    });
    const service = createOrderService({
      repository: repo,
      shippingService: shippingService(),
      now: () => now,
    });

    await expect(service.createOrder(sessionId, key, reviewed())).rejects.toBeInstanceOf(
      OrderStateChangedError,
    );
  });
});
