import { describe, expect, it, vi } from "vitest";
import {
  createOrderQueryService,
  type OrderQueryRepository,
  type PublicOrder,
  type PublicOrderSummary,
} from "./order-query-service";
import { createOrderEmailAccessToken } from "./order-email-access";

const order = Object.freeze({ orderNumber: "RNR-2026-ABC", createdAt: "2026-08-02T00:00:00.000Z", paymentStatus: "awaiting_payment", fulfilmentStatus: "new", currency: "NZD", deliveryMethod: "pickup", shipping: { serviceName: "Pickup", provider: null, isTest: false, amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0 }, totals: { productSubtotalExGstCents: 6500, productGstCents: 975, productTotalInclGstCents: 7475, totalExGstCents: 6500, totalGstCents: 975, totalInclGstCents: 7475 }, items: [], addresses: { billing: {}, delivery: {} } } as unknown as PublicOrder);
const orderSummary = Object.freeze({
  orderNumber: order.orderNumber,
  createdAt: order.createdAt,
  paymentStatus: order.paymentStatus,
  fulfilmentStatus: order.fulfilmentStatus,
  currency: order.currency,
  totals: Object.freeze({ totalInclGstCents: order.totals.totalInclGstCents }),
}) satisfies PublicOrderSummary;
function repository(): OrderQueryRepository { return { findByCheckoutToken: vi.fn().mockResolvedValue(null), findByCustomer: vi.fn().mockResolvedValue(null), findByEmailAccess: vi.fn().mockResolvedValue(null), listByCustomer: vi.fn().mockResolvedValue([]), listPageByCustomer: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, pageCount: 0 }) }; }

describe("owner-scoped order queries", () => {
  it("lets a completed checkout cookie read only its order", async () => { const repo = repository(); vi.mocked(repo.findByCheckoutToken).mockResolvedValue(order); const service = createOrderQueryService(repo); await expect(service.confirmation("RNR-2026-ABC", { tokenDigest: "digest", userId: null })).resolves.toBe(order); expect(repo.findByCheckoutToken).toHaveBeenCalledWith("RNR-2026-ABC", "digest"); });
  it("falls back from a cookie miss only to the signed-in owner and does not enumerate anonymous misses", async () => { const repo = repository(); vi.mocked(repo.findByCustomer).mockResolvedValue(order); const service = createOrderQueryService(repo); await expect(service.confirmation("RNR-2026-ABC", { tokenDigest: "wrong", userId: "user-1" })).resolves.toBe(order); expect(repo.findByCheckoutToken).toHaveBeenCalledWith("RNR-2026-ABC", "wrong"); expect(repo.findByCustomer).toHaveBeenCalledWith("RNR-2026-ABC", "user-1"); await expect(service.confirmation("missing", { tokenDigest: null, userId: null })).resolves.toBeNull(); });
  it("uses only a valid order-bound email token when browser identity is absent", async () => {
    const repo = repository();
    const secret = "order-email-access-secret-with-sufficient-entropy-12345";
    const now = new Date("2026-08-16T06:30:00.000Z");
    const token = createOrderEmailAccessToken(order.orderNumber, secret, now);
    vi.mocked(repo.findByEmailAccess).mockResolvedValue(order);
    const service = createOrderQueryService(repo, { orderAccessSecret: secret, now: () => now });

    await expect(service.confirmation(order.orderNumber, {
      tokenDigest: null,
      userId: null,
      emailAccessToken: token,
    })).resolves.toBe(order);
    expect(repo.findByEmailAccess).toHaveBeenCalledWith(order.orderNumber);

    vi.mocked(repo.findByEmailAccess).mockClear();
    await expect(service.confirmation("RNR-2026-OTHER", {
      tokenDigest: null,
      userId: null,
      emailAccessToken: token,
    })).resolves.toBeNull();
    expect(repo.findByEmailAccess).not.toHaveBeenCalled();
  });
  it("keeps account lists minimized while returning authorized order details", async () => {
    const detailedOrder = Object.freeze({
      ...order,
      items: Object.freeze([Object.freeze({
        bundleComponents: Object.freeze([Object.freeze({
          componentKey: "roll-up",
          photoSubmissionMethod: "later",
          designText: "Private detail wording",
          notes: "Private detail notes",
          photoCount: 0,
          backgroundRemovalCount: 0,
        })]),
      })]),
    }) as unknown as PublicOrder;
    const repo = repository();
    vi.mocked(repo.listByCustomer).mockResolvedValue([orderSummary]);
    vi.mocked(repo.findByCustomer).mockResolvedValue(detailedOrder);
    const service = createOrderQueryService(repo);

    const history = await service.accountOrders("user-1");
    expect(history).toEqual([orderSummary]);
    expect(JSON.stringify(history)).not.toMatch(/Private detail|items|bundleComponents/);

    await expect(service.accountOrder("RNR-2026-ABC", "user-1"))
      .resolves.toBe(detailedOrder);
    expect(JSON.stringify(detailedOrder)).toMatch(/Private detail wording|Private detail notes/);
    expect(repo.findByCustomer).toHaveBeenCalledWith("RNR-2026-ABC", "user-1");
  });
  it("public read models contain no internal ownership identifiers", () => { expect(JSON.stringify(order)).not.toMatch(/checkoutSessionId|tokenDigest|customerId|shippingQuoteId|"id"/); expect(Object.isFrozen(order)).toBe(true); });
});
