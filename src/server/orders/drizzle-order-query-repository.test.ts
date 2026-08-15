import { describe, expect, it, vi } from "vitest";
import { orderAddresses, orderItems, orders, paymentAttempts } from "@/server/db/schema";
import {
  buildPublicOrders,
  createDrizzleOrderQueryRepository,
  OrderSnapshotIntegrityError,
} from "./drizzle-order-query-repository";

type OrderRow = typeof orders.$inferSelect;
type ItemRow = typeof orderItems.$inferSelect;
type AddressRow = typeof orderAddresses.$inferSelect;
type PaymentReadRow = Pick<
  typeof paymentAttempts.$inferSelect,
  "orderId" | "method" | "status" | "provider" | "createdAt" | "updatedAt" | "id"
>;

const createdAt = new Date("2026-08-02T00:00:00.000Z");
const orderRow: OrderRow = {
  id: "10000000-0000-4000-8000-000000000001",
  orderNumber: "RNR-2026-ABC",
  checkoutSessionId: "20000000-0000-4000-8000-000000000001",
  checkoutSessionVersion: 2,
  idempotencyKey: "30000000-0000-4000-8000-000000000001",
  customerId: "user-1",
  customerEmail: "aroha@example.test",
  market: "NZ",
  currency: "NZD",
  priceBookRevision: 0,
  taxJurisdiction: "NZ_GST",
  taxRateBasisPoints: 1_500,
  discountCents: 0,
  designSurchargeCents: 0,
  pricingSnapshot: {} as OrderRow["pricingSnapshot"],
  deliveryMethod: "pickup",
  shippingQuoteId: null,
  shippingProvider: null,
  shippingServiceCode: "pickup",
  shippingServiceName: "Pickup",
  shippingProviderReference: null,
  shippingIsTest: false,
    shippingRequestDigest: null,
    attribution: null,
  productSubtotalExGstCents: 6500,
  productGstCents: 975,
  productTotalInclGstCents: 7475,
  shippingExGstCents: 0,
  shippingGstCents: 0,
  shippingTotalInclGstCents: 0,
  totalExGstCents: 6500,
  totalGstCents: 975,
  totalInclGstCents: 7475,
  paymentStatus: "awaiting_payment",
  fulfilmentStatus: "new",
  trackingNumber: null,
  trackingCarrier: null,
  trackingUrl: null,
  shippedAt: null,
  completedAt: null,
  cancelledAt: null,
  createdAt,
  updatedAt: createdAt,
};
const itemRow: ItemRow = {
  id: "40000000-0000-4000-8000-000000000001",
  checkoutSessionId: orderRow.checkoutSessionId,
  orderId: orderRow.id,
  position: 0,
  clientItemId: "50000000-0000-4000-8000-000000000001",
  productKey: "photo-print-canvas",
  productSlug: "photo-print-canvas",
  productTitle: "Photo Print Canvas",
  galleryDesignId: null,
  galleryDesignTitle: null,
  galleryDesignContentHash: null,
  galleryDesignProductSlug: null,
  sizeKey: "a4",
  sizeLabel: "A4",
  orientation: "landscape",
  peoplePets: 0,
  photoSubmissionMethod: "later",
  designText: "Family",
  notes: "",
  neededDate: "2026-08-10",
  urgentServiceConfirmed: false,
  urgentWorkingDays: 5,
  quantity: 1,
  priceLines: [
    { key: "product-size", label: "Product / size price", amountExGstCents: 6500 },
    { key: "no-charge", label: "No-charge adjustment", amountExGstCents: 0, amountInclGstCents: 0, internalMetadata: "private" },
  ] as ItemRow["priceLines"],
  uploadReferences: [],
  unitSubtotalExGstCents: 6500,
  unitGstCents: 975,
  unitTotalInclGstCents: 7475,
  lineSubtotalExGstCents: 6500,
  lineGstCents: 975,
  lineTotalInclGstCents: 7475,
  createdAt,
};
const addressBase = {
  orderId: orderRow.id,
  country: "NZ",
  fullName: "Aroha Ngata",
  building: "",
  street: "12 Queen Street",
  suburb: "Auckland Central",
  region: "Auckland",
  postcode: "1010",
  phone: "+64211234567",
  email: "aroha@example.test",
  createdAt,
} as const;
const addresses: AddressRow[] = [
  { ...addressBase, id: "60000000-0000-4000-8000-000000000001", kind: "billing" },
  { ...addressBase, id: "60000000-0000-4000-8000-000000000002", kind: "delivery" },
];
const attemptRow: PaymentReadRow = {
  id: "70000000-0000-4000-8000-000000000001",
  orderId: orderRow.id,
  method: "afterpay",
  provider: "local-test",
  status: "failed",
  createdAt: new Date("2026-08-02T00:01:00.000Z"),
  updatedAt: new Date("2026-08-02T00:01:00.000Z"),
};

describe("Drizzle order query read model", () => {
  it.each(["guest", "customer", "list"] as const)(
    "reads the authorized %s order and its payment snapshot in one read-only repeatable-read transaction",
    async (kind) => {
      const results = kind === "guest"
        ? [[{ order: { ...orderRow, customerId: null } }], [itemRow], addresses, [attemptRow]]
        : [[orderRow], [itemRow], addresses, [attemptRow]];
      let readInFlight = false;
      const transactionSelect = vi.fn((selection?: unknown) => {
        void selection;
        const value = results.shift() ?? [];
        const query = {
          from: () => query,
          innerJoin: () => query,
          where: () => query,
          orderBy: () => query,
          limit: () => query,
          then: (
            resolve: (rows: unknown[]) => unknown,
            reject: (error: unknown) => unknown,
          ) => {
            if (readInFlight) {
              return Promise.reject(new Error("transaction reads overlapped")).then(resolve, reject);
            }
            readInFlight = true;
            return Promise.resolve().then(() => {
              readInFlight = false;
              return value;
            }).then(resolve, reject);
          },
        };
        return query;
      });
      const transaction = { select: transactionSelect };
      const database = {
        select: vi.fn(() => { throw new Error("query escaped the snapshot transaction"); }),
        transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>, config: unknown) => {
          expect(config).toEqual({ isolationLevel: "repeatable read", accessMode: "read only" });
          return callback(transaction);
        }),
      };
      const repository = createDrizzleOrderQueryRepository(
        database as unknown as Parameters<typeof createDrizzleOrderQueryRepository>[0],
      );

      const result = kind === "guest"
        ? await repository.findByCheckoutToken(orderRow.orderNumber, "token-digest")
        : kind === "customer"
          ? await repository.findByCustomer(orderRow.orderNumber, "user-1")
          : await repository.listByCustomer("user-1");

      expect(result).toBeTruthy();
      expect(database.transaction).toHaveBeenCalledTimes(1);
      expect(database.select).not.toHaveBeenCalled();
      expect(transactionSelect).toHaveBeenCalledTimes(4);
      expect(results).toHaveLength(0);
      expect(transactionSelect.mock.calls[0]).toEqual(kind === "guest" ? [{ order: orders }] : []);
      expect(transactionSelect.mock.calls[3]?.[0]).toMatchObject({
        orderId: paymentAttempts.orderId,
        method: paymentAttempts.method,
        status: paymentAttempts.status,
        provider: paymentAttempts.provider,
        createdAt: paymentAttempts.createdAt,
        id: paymentAttempts.id,
      });
      expect(transactionSelect.mock.calls[3]?.[0]).not.toHaveProperty("updatedAt");
    },
  );

  it("maps only the explicit public field whitelist and freezes nested snapshots", () => {
    const galleryDesignId = "a".repeat(64);
    const galleryItem = {
      ...itemRow,
      galleryDesignId,
      galleryDesignTitle: "Family at sunset",
      galleryDesignContentHash: "b".repeat(64),
      galleryDesignProductSlug: "photo-print-canvas",
    };
    const [result] = buildPublicOrders([orderRow], [galleryItem], addresses, [attemptRow]);

    expect(Object.keys(result)).toEqual([
      "orderNumber", "createdAt", "paymentStatus", "fulfilmentStatus", "currency",
      "deliveryMethod", "shipping", "totals", "items", "addresses", "payment",
    ]);
    expect(Object.keys(result.items[0])).toEqual([
      "productTitle", "galleryDesign", "sizeLabel", "orientation", "peoplePets", "photoSubmissionMethod",
      "designText", "notes", "neededDate", "urgentServiceConfirmed", "urgentWorkingDays",
      "quantity", "priceLines", "unitSubtotalExGstCents", "unitGstCents", "unitTotalInclGstCents",
      "lineSubtotalExGstCents", "lineGstCents", "lineTotalInclGstCents",
    ]);
    expect(JSON.stringify(result)).not.toMatch(/checkoutSessionId|tokenDigest|customerId|shippingQuoteId|idempotencyKey|uploadReferences/);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.items)).toBe(true);
    expect(Object.isFrozen(result.items[0])).toBe(true);
    expect(result.items[0].galleryDesign).toEqual({
      id: galleryDesignId,
      title: "Family at sunset",
      contentHash: "b".repeat(64),
      productSlug: "photo-print-canvas",
      imageUrl: `/gallery-images/${galleryDesignId}?v=${"b".repeat(64)}`,
    });
    expect(Object.isFrozen(result.items[0].galleryDesign)).toBe(true);
    expect(result.items[0].priceLines).toEqual([
      { key: "product-size", label: "Product / size price", amountExGstCents: 6500 },
      { key: "no-charge", label: "No-charge adjustment", amountExGstCents: 0, amountInclGstCents: 0 },
    ]);
    expect(JSON.stringify(result)).not.toContain("internalMetadata");
    expect(Object.isFrozen(result.items[0].priceLines)).toBe(true);
    expect(Object.isFrozen(result.items[0].priceLines[0])).toBe(true);
    expect(Object.isFrozen(result.addresses.billing)).toBe(true);
    expect(result.payment).toEqual({
      method: "afterpay",
      status: "failed",
      canRetry: true,
      isTest: true,
    });
    expect(Object.keys(result.payment ?? {}).sort()).toEqual([
      "canRetry", "isTest", "method", "status",
    ]);
    expect(Object.isFrozen(result.payment)).toBe(true);
    expect(JSON.stringify(result.payment)).not.toMatch(
      /providerReference|attemptId|clientSecret|returnState|failure|event|provider|createdAt|updatedAt|id/,
    );
  });

  it("returns null when an authorized order has no payment attempt", () => {
    const [result] = buildPublicOrders([orderRow], [itemRow], addresses, []);

    expect(result.payment).toBeNull();
  });

  it("normalizes legacy Grave Cover order display without changing monetary snapshots", () => {
    const legacyItem = {
      ...itemRow,
      productKey: "grave-cover",
      productSlug: "grave-cover",
      productTitle: "Grave Cover",
      sizeKey: "standard",
      sizeLabel: "200 × 100 cm",
      orientation: "portrait" as const,
    };

    const [result] = buildPublicOrders([orderRow], [legacyItem], addresses, []);
    expect(result.items[0].sizeLabel).toBe("100 × 200 cm");
    expect(result.items[0]).not.toHaveProperty("orientation");
    expect(result.items[0].lineTotalInclGstCents).toBe(itemRow.lineTotalInclGstCents);
  });

  it("selects the newest attempt by immutable creation order instead of mutable updated time", () => {
    const newerProcessing: PaymentReadRow = {
      ...attemptRow,
      id: "70000000-0000-4000-8000-000000000010",
      method: "card",
      provider: "stripe",
      status: "processing",
      createdAt: new Date("2026-08-02T00:02:00.000Z"),
      updatedAt: new Date("2026-08-02T00:02:00.000Z"),
    };
    const staleFailureWithLateUpdate: PaymentReadRow = {
      ...attemptRow,
      createdAt: new Date("2026-08-02T00:01:00.000Z"),
      updatedAt: new Date("2026-08-02T00:05:00.000Z"),
    };

    const [result] = buildPublicOrders(
      [{ ...orderRow, paymentStatus: "processing" }],
      [itemRow],
      addresses,
      [staleFailureWithLateUpdate, newerProcessing],
    );

    expect(result.payment).toEqual({
      method: "card",
      status: "processing",
      canRetry: false,
      isTest: false,
    });
  });

  it("uses descending attempt id as the stable tie-breaker for equal creation times", () => {
    const lowerId: PaymentReadRow = {
      ...attemptRow,
      id: "70000000-0000-4000-8000-000000000001",
      method: "afterpay",
      status: "failed",
    };
    const higherId: PaymentReadRow = {
      ...attemptRow,
      id: "70000000-0000-4000-8000-000000000099",
      method: "card",
      provider: "stripe",
      status: "processing",
    };

    const [result] = buildPublicOrders(
      [{ ...orderRow, paymentStatus: "processing" }],
      [itemRow],
      addresses,
      [lowerId, higherId],
    );

    expect(result.payment).toEqual({
      method: "card",
      status: "processing",
      canRetry: false,
      isTest: false,
    });
  });

  it.each([
    ["paid", "paid"],
    ["refunded", "refunded"],
  ] as const)(
    "uses the newest paid attempt for a %s order and reports %s",
    (paymentStatus, expectedStatus) => {
      const paidAttempt: PaymentReadRow = {
        ...attemptRow,
        method: "card",
        provider: "stripe",
        status: "paid",
      };
      const laterFailure: PaymentReadRow = {
        ...attemptRow,
        id: "70000000-0000-4000-8000-000000000011",
        status: "failed",
        createdAt: new Date("2026-08-02T00:03:00.000Z"),
        updatedAt: new Date("2026-08-02T00:03:00.000Z"),
      };

      const [result] = buildPublicOrders(
        [{ ...orderRow, paymentStatus }],
        [itemRow],
        addresses,
        [laterFailure, paidAttempt],
      );

      expect(result.payment).toEqual({
        method: "card",
        status: expectedStatus,
        canRetry: false,
        isTest: false,
      });
    },
  );

  it("fails closed when either immutable address snapshot is missing", () => {
    expect(() => buildPublicOrders([orderRow], [itemRow], addresses.slice(0, 1)))
      .toThrow(OrderSnapshotIntegrityError);
  });

  it("accepts ordinary orders needed more than five working days away", () => {
    const [result] = buildPublicOrders(
      [orderRow],
      [{ ...itemRow, neededDate: "2026-08-20", urgentWorkingDays: 12 }],
      addresses,
    );

    expect(result.items[0]).toMatchObject({
      neededDate: "2026-08-20",
      urgentServiceConfirmed: false,
      urgentWorkingDays: 12,
    });
  });

  it.each([
    "new",
    "designing",
    "awaiting_customer",
    "ready_to_print",
    "printing",
    "on_hold",
    "shipped",
    "completed",
    "cancelled",
  ] as const)("displays an order in the supported %s fulfilment state", (fulfilmentStatus) => {
    const [result] = buildPublicOrders(
      [{ ...orderRow, fulfilmentStatus }],
      [itemRow],
      addresses,
    );

    expect(result.fulfilmentStatus).toBe(fulfilmentStatus);
  });

  const corruptions: [string, { row?: OrderRow; items?: ItemRow[]; item?: ItemRow; addressRows?: AddressRow[] }][] = [
    ["missing item", { items: [] as ItemRow[] }],
    ["unknown payment status", { row: { ...orderRow, paymentStatus: "unknown" } as unknown as OrderRow }],
    ["unknown fulfilment status", { row: { ...orderRow, fulfilmentStatus: "unknown" } as unknown as OrderRow }],
    ["unknown currency", { row: { ...orderRow, currency: "USD" } as unknown as OrderRow }],
    ["market currency mismatch", { row: { ...orderRow, market: "AU", currency: "NZD" } }],
    ["unknown delivery method", { row: { ...orderRow, deliveryMethod: "courier" } as unknown as OrderRow }],
    ["unknown shipping provider", { row: { ...orderRow, deliveryMethod: "post", shippingProvider: "unknown" } as unknown as OrderRow }],
    ["invalid pickup provenance", { row: { ...orderRow, shippingIsTest: true } }],
    ["invalid created date", { row: { ...orderRow, createdAt: new Date(Number.NaN) } }],
    ["invalid address", { addressRows: addresses.map((value, index) => index ? value : { ...value, postcode: "bad" }) as AddressRow[] }],
    ["invalid price line", { item: { ...itemRow, priceLines: [{ key: "bad", label: "Bad", amountExGstCents: -1 }] } as ItemRow }],
    ["invalid tax-inclusive price line", { item: { ...itemRow, priceLines: [{ key: "product-size", label: "Product / size price", amountExGstCents: 6500, amountInclGstCents: 99_999 }] } as ItemRow }],
    ["invalid item quantity", { item: { ...itemRow, quantity: 0 } }],
    ["invalid item position", { item: { ...itemRow, position: 2 } }],
    ["invalid needed date", { item: { ...itemRow, neededDate: "2026-02-31" } }],
    ["partial gallery snapshot", { item: { ...itemRow, galleryDesignId: "a".repeat(64) } }],
    ["item money imbalance", { item: { ...itemRow, lineTotalInclGstCents: 7476 } }],
    ["order money imbalance", { row: { ...orderRow, totalInclGstCents: 7476 } }],
  ];

  it.each(corruptions)("rejects a corrupt %s without exposing snapshot data", (_label, change) => {
    const invoke = () => buildPublicOrders(
      [change.row ?? orderRow],
      change.items ?? [change.item ?? itemRow],
      change.addressRows ?? addresses,
    );

    expect(invoke).toThrow(OrderSnapshotIntegrityError);
    try {
      invoke();
    } catch (error) {
      expect(error).toMatchObject({ message: "Order snapshot cannot be displayed" });
      expect(String(error)).not.toContain(orderRow.orderNumber);
      expect(String(error)).not.toContain(addressBase.email);
    }
  });
});
