import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";
import { checkoutSessions, orderAddresses, orderItems, orders } from "@/server/db/schema";
import { normalizeAddress } from "@/domain/address/schema";
import type { OrderQueryRepository, PublicOrder } from "./order-query-service";

type Database = ReturnType<typeof getDatabase>;
type OrderRow = typeof orders.$inferSelect;
type OrderItemRow = typeof orderItems.$inferSelect;
type OrderAddressRow = typeof orderAddresses.$inferSelect;

const paymentStatuses = new Set(["awaiting_payment", "processing", "paid", "failed", "cancelled", "refunded"]);
const fulfilmentStatuses = new Set(["new"]);
const deliveryMethods = new Set(["pickup", "post"]);
const shippingProviders = new Set(["gosweetspot", "local-test"]);
const orientations = new Set(["landscape", "portrait"]);
const photoSubmissionMethods = new Set(["upload", "later"]);

export class OrderSnapshotIntegrityError extends Error {
  constructor() {
    super("Order snapshot cannot be displayed");
    this.name = "OrderSnapshotIntegrityError";
  }
}

function assertSnapshot(condition: unknown): asserts condition {
  if (!condition) throw new OrderSnapshotIntegrityError();
}

function isMoney(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function assertMoneyBalance(total: number, first: number, second: number) {
  assertSnapshot(isMoney(total) && isMoney(first) && isMoney(second));
  assertSnapshot(total === first + second);
}

function validateOrderRow(row: OrderRow) {
  assertSnapshot(paymentStatuses.has(row.paymentStatus));
  assertSnapshot(fulfilmentStatuses.has(row.fulfilmentStatus));
  assertSnapshot(row.currency === "NZD");
  assertSnapshot(deliveryMethods.has(row.deliveryMethod));
  assertSnapshot(row.createdAt instanceof Date && Number.isFinite(row.createdAt.getTime()));
  assertSnapshot(isNonEmptyString(row.shippingServiceName));
  assertSnapshot(typeof row.shippingIsTest === "boolean");
  assertMoneyBalance(row.productTotalInclGstCents, row.productSubtotalExGstCents, row.productGstCents);
  assertMoneyBalance(row.shippingTotalInclGstCents, row.shippingExGstCents, row.shippingGstCents);
  assertMoneyBalance(row.totalExGstCents, row.productSubtotalExGstCents, row.shippingExGstCents);
  assertMoneyBalance(row.totalGstCents, row.productGstCents, row.shippingGstCents);
  assertMoneyBalance(row.totalInclGstCents, row.totalExGstCents, row.totalGstCents);
  if (row.deliveryMethod === "pickup") {
    assertSnapshot(row.shippingProvider === null && row.shippingServiceName === "Pickup");
    assertSnapshot(row.shippingIsTest === false);
    assertSnapshot(row.shippingExGstCents === 0 && row.shippingGstCents === 0 && row.shippingTotalInclGstCents === 0);
  } else {
    assertSnapshot(row.shippingProvider !== null && shippingProviders.has(row.shippingProvider));
    assertSnapshot(row.shippingIsTest === (row.shippingProvider === "local-test"));
    assertSnapshot(row.shippingTotalInclGstCents > 0);
  }
}

function publicAddress(addressRows: OrderAddressRow[], kind: "billing" | "delivery") {
  const matches = addressRows.filter((address) => address.kind === kind);
  assertSnapshot(matches.length === 1);
  const { country, fullName, building, street, suburb, region, postcode, phone, email } = matches[0];
  return normalizeAddress({ country, fullName, building, street, suburb, region, postcode, phone, email });
}

function publicItems(itemRows: OrderItemRow[]) {
  assertSnapshot(itemRows.length > 0);
  return itemRows.map((item, index) => {
    assertSnapshot(item.position === index);
    assertSnapshot(isNonEmptyString(item.productTitle) && isNonEmptyString(item.sizeLabel));
    assertSnapshot(item.orientation === null || orientations.has(item.orientation));
    assertSnapshot(Number.isSafeInteger(item.peoplePets) && item.peoplePets >= 0 && item.peoplePets <= 20);
    assertSnapshot(photoSubmissionMethods.has(item.photoSubmissionMethod));
    assertSnapshot(typeof item.designText === "string" && typeof item.notes === "string");
    assertSnapshot(isIsoCalendarDate(item.neededDate));
    assertSnapshot(typeof item.urgentServiceConfirmed === "boolean");
    assertSnapshot(Number.isSafeInteger(item.urgentWorkingDays) && item.urgentWorkingDays >= 1 && item.urgentWorkingDays <= 5);
    assertSnapshot(Number.isSafeInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 5);
    assertSnapshot(Array.isArray(item.priceLines) && item.priceLines.length > 0);
    const keys = new Set<string>();
    const priceLines = item.priceLines.map((line) => {
      assertSnapshot(isNonEmptyString(line.key) && isNonEmptyString(line.label));
      assertSnapshot(!keys.has(line.key));
      keys.add(line.key);
      assertSnapshot(isMoney(line.amountExGstCents));
      if (line.amountInclGstCents !== undefined) {
        assertSnapshot(isMoney(line.amountInclGstCents));
        assertSnapshot(Math.round((line.amountInclGstCents * 100) / 115) === line.amountExGstCents);
      }
      return Object.freeze({
        key: line.key,
        label: line.label,
        amountExGstCents: line.amountExGstCents,
        ...(line.amountInclGstCents === undefined ? {} : { amountInclGstCents: line.amountInclGstCents }),
      });
    });
    assertMoneyBalance(item.unitTotalInclGstCents, item.unitSubtotalExGstCents, item.unitGstCents);
    assertSnapshot(item.lineSubtotalExGstCents === item.unitSubtotalExGstCents * item.quantity);
    assertSnapshot(item.lineGstCents === item.unitGstCents * item.quantity);
    assertSnapshot(item.lineTotalInclGstCents === item.unitTotalInclGstCents * item.quantity);
    assertSnapshot(priceLines.reduce((sum, line) => sum + line.amountExGstCents, 0) === item.unitSubtotalExGstCents);
    return Object.freeze({
      productTitle: item.productTitle, sizeLabel: item.sizeLabel,
      ...(item.orientation ? { orientation: item.orientation } : {}),
      peoplePets: item.peoplePets, photoSubmissionMethod: item.photoSubmissionMethod,
      designText: item.designText, notes: item.notes, neededDate: item.neededDate,
      urgentServiceConfirmed: item.urgentServiceConfirmed, urgentWorkingDays: item.urgentWorkingDays,
      quantity: item.quantity, priceLines: Object.freeze(priceLines),
      unitSubtotalExGstCents: item.unitSubtotalExGstCents,
      unitGstCents: item.unitGstCents, unitTotalInclGstCents: item.unitTotalInclGstCents,
      lineSubtotalExGstCents: item.lineSubtotalExGstCents, lineGstCents: item.lineGstCents,
      lineTotalInclGstCents: item.lineTotalInclGstCents,
    });
  });
}

export function buildPublicOrders(
  rows: OrderRow[],
  items: OrderItemRow[],
  addresses: OrderAddressRow[],
): PublicOrder[] {
  return rows.map((row) => {
    try {
      validateOrderRow(row);
      const itemRows = items.filter(({ orderId }) => orderId === row.id);
      const mappedItems = publicItems(itemRows);
      assertSnapshot(mappedItems.reduce((sum, item) => sum + item.lineSubtotalExGstCents, 0) === row.productSubtotalExGstCents);
      assertSnapshot(mappedItems.reduce((sum, item) => sum + item.lineGstCents, 0) === row.productGstCents);
      assertSnapshot(mappedItems.reduce((sum, item) => sum + item.lineTotalInclGstCents, 0) === row.productTotalInclGstCents);
      const addressRows = addresses.filter(({ orderId }) => orderId === row.id);
      return Object.freeze({
        orderNumber: row.orderNumber, createdAt: row.createdAt.toISOString(),
        paymentStatus: row.paymentStatus, fulfilmentStatus: row.fulfilmentStatus,
        currency: row.currency, deliveryMethod: row.deliveryMethod,
        shipping: Object.freeze({ provider: row.shippingProvider, serviceName: row.shippingServiceName, isTest: row.shippingIsTest, amountExGstCents: row.shippingExGstCents, gstCents: row.shippingGstCents, amountInclGstCents: row.shippingTotalInclGstCents }),
        totals: Object.freeze({ productSubtotalExGstCents: row.productSubtotalExGstCents, productGstCents: row.productGstCents, productTotalInclGstCents: row.productTotalInclGstCents, totalExGstCents: row.totalExGstCents, totalGstCents: row.totalGstCents, totalInclGstCents: row.totalInclGstCents }),
        items: Object.freeze(mappedItems), addresses: Object.freeze({ billing: publicAddress(addressRows, "billing"), delivery: publicAddress(addressRows, "delivery") }),
      });
    } catch {
      throw new OrderSnapshotIntegrityError();
    }
  });
}

export function createDrizzleOrderQueryRepository(database: Database): OrderQueryRepository {
  async function hydrate(rows: OrderRow[]): Promise<PublicOrder[]> {
    if (!rows.length) return [];
    const ids = rows.map(({ id }) => id);
    const [items, addresses] = await Promise.all([
      database.select().from(orderItems).where(inArray(orderItems.orderId, ids)).orderBy(orderItems.position),
      database.select().from(orderAddresses).where(inArray(orderAddresses.orderId, ids)),
    ]);
    return buildPublicOrders(rows, items, addresses);
  }
  async function one(rows: OrderRow[]) { return (await hydrate(rows))[0] ?? null; }
  return {
    async findByCheckoutToken(orderNumber, tokenDigest) {
      const rows = await database.select({ order: orders }).from(orders).innerJoin(checkoutSessions, and(eq(checkoutSessions.id, orders.checkoutSessionId), eq(checkoutSessions.tokenDigest, tokenDigest), isNotNull(checkoutSessions.completedAt), sql`${checkoutSessions.expiresAt} > clock_timestamp()`)).where(and(eq(orders.orderNumber, orderNumber), isNull(orders.customerId))).limit(1);
      return one(rows.map(({ order }) => order));
    },
    async findByCustomer(orderNumber, customerId) { return one(await database.select().from(orders).where(and(eq(orders.orderNumber, orderNumber), eq(orders.customerId, customerId))).limit(1)); },
    async listByCustomer(customerId) { return hydrate(await database.select().from(orders).where(eq(orders.customerId, customerId)).orderBy(desc(orders.createdAt), desc(orders.orderNumber))); },
  };
}
