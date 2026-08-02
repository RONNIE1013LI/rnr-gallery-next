import { describe, expect, it } from "vitest";
import { orderAddresses, orderItems, orders } from "@/server/db/schema";
import {
  buildPublicOrders,
  OrderSnapshotIntegrityError,
} from "./drizzle-order-query-repository";

type OrderRow = typeof orders.$inferSelect;
type ItemRow = typeof orderItems.$inferSelect;
type AddressRow = typeof orderAddresses.$inferSelect;

const createdAt = new Date("2026-08-02T00:00:00.000Z");
const orderRow: OrderRow = {
  id: "10000000-0000-4000-8000-000000000001",
  orderNumber: "RNR-2026-ABC",
  checkoutSessionId: "20000000-0000-4000-8000-000000000001",
  checkoutSessionVersion: 2,
  idempotencyKey: "30000000-0000-4000-8000-000000000001",
  customerId: "user-1",
  customerEmail: "aroha@example.test",
  currency: "NZD",
  deliveryMethod: "pickup",
  shippingQuoteId: null,
  shippingProvider: null,
  shippingServiceCode: "pickup",
  shippingServiceName: "Pickup",
  shippingProviderReference: null,
  shippingIsTest: false,
  shippingRequestDigest: null,
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

describe("Drizzle order query read model", () => {
  it("maps only the explicit public field whitelist and freezes nested snapshots", () => {
    const [result] = buildPublicOrders([orderRow], [itemRow], addresses);

    expect(Object.keys(result)).toEqual([
      "orderNumber", "createdAt", "paymentStatus", "fulfilmentStatus", "currency",
      "deliveryMethod", "shipping", "totals", "items", "addresses",
    ]);
    expect(Object.keys(result.items[0])).toEqual([
      "productTitle", "sizeLabel", "orientation", "peoplePets", "photoSubmissionMethod",
      "designText", "notes", "neededDate", "urgentServiceConfirmed", "urgentWorkingDays",
      "quantity", "priceLines", "unitSubtotalExGstCents", "unitGstCents", "unitTotalInclGstCents",
      "lineSubtotalExGstCents", "lineGstCents", "lineTotalInclGstCents",
    ]);
    expect(JSON.stringify(result)).not.toMatch(/checkoutSessionId|tokenDigest|customerId|shippingQuoteId|idempotencyKey|uploadReferences/);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.items)).toBe(true);
    expect(Object.isFrozen(result.items[0])).toBe(true);
    expect(result.items[0].priceLines).toEqual([
      { key: "product-size", label: "Product / size price", amountExGstCents: 6500 },
      { key: "no-charge", label: "No-charge adjustment", amountExGstCents: 0, amountInclGstCents: 0 },
    ]);
    expect(JSON.stringify(result)).not.toContain("internalMetadata");
    expect(Object.isFrozen(result.items[0].priceLines)).toBe(true);
    expect(Object.isFrozen(result.items[0].priceLines[0])).toBe(true);
    expect(Object.isFrozen(result.addresses.billing)).toBe(true);
  });

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

  const corruptions: [string, { row?: OrderRow; items?: ItemRow[]; item?: ItemRow; addressRows?: AddressRow[] }][] = [
    ["missing item", { items: [] as ItemRow[] }],
    ["unknown payment status", { row: { ...orderRow, paymentStatus: "unknown" } as unknown as OrderRow }],
    ["unknown fulfilment status", { row: { ...orderRow, fulfilmentStatus: "unknown" } as unknown as OrderRow }],
    ["unknown currency", { row: { ...orderRow, currency: "AUD" } as unknown as OrderRow }],
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
