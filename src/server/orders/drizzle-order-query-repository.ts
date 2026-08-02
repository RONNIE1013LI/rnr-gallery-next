import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";
import { checkoutSessions, orderAddresses, orderItems, orders } from "@/server/db/schema";
import type { NormalizedAddress } from "@/domain/address/types";
import type { OrderQueryRepository, PublicOrder } from "./order-query-service";

type Database = ReturnType<typeof getDatabase>;
type OrderRow = typeof orders.$inferSelect;
type OrderItemRow = typeof orderItems.$inferSelect;
type OrderAddressRow = typeof orderAddresses.$inferSelect;

export function buildPublicOrders(
  rows: OrderRow[],
  items: OrderItemRow[],
  addresses: OrderAddressRow[],
): PublicOrder[] {
  return rows.map((row) => {
    const addressRows = addresses.filter(({ orderId }) => orderId === row.id);
    const publicAddress = (kind: "billing" | "delivery") => {
      const value = addressRows.find((address) => address.kind === kind);
      if (!value) throw new Error(`Order ${row.orderNumber} has no ${kind} address snapshot`);
      const { country, fullName, building, street, suburb, region, postcode, phone, email } = value;
      return Object.freeze({ country, fullName, building, street, suburb, region, postcode, phone, email }) as NormalizedAddress;
    };
    const publicItems = items.filter(({ orderId }) => orderId === row.id).map((item) => Object.freeze({
      productTitle: item.productTitle, sizeLabel: item.sizeLabel,
      ...(item.orientation ? { orientation: item.orientation } : {}),
      peoplePets: item.peoplePets, photoSubmissionMethod: item.photoSubmissionMethod,
      designText: item.designText, notes: item.notes, neededDate: item.neededDate,
      urgentServiceConfirmed: item.urgentServiceConfirmed, urgentWorkingDays: item.urgentWorkingDays,
      quantity: item.quantity, unitSubtotalExGstCents: item.unitSubtotalExGstCents,
      unitGstCents: item.unitGstCents, unitTotalInclGstCents: item.unitTotalInclGstCents,
      lineSubtotalExGstCents: item.lineSubtotalExGstCents, lineGstCents: item.lineGstCents,
      lineTotalInclGstCents: item.lineTotalInclGstCents,
    }));
    return Object.freeze({
      orderNumber: row.orderNumber, createdAt: row.createdAt.toISOString(),
      paymentStatus: row.paymentStatus, fulfilmentStatus: row.fulfilmentStatus,
      currency: row.currency, deliveryMethod: row.deliveryMethod,
      shipping: Object.freeze({ provider: row.shippingProvider, serviceName: row.shippingServiceName, isTest: row.shippingIsTest, amountExGstCents: row.shippingExGstCents, gstCents: row.shippingGstCents, amountInclGstCents: row.shippingTotalInclGstCents }),
      totals: Object.freeze({ productSubtotalExGstCents: row.productSubtotalExGstCents, productGstCents: row.productGstCents, productTotalInclGstCents: row.productTotalInclGstCents, totalExGstCents: row.totalExGstCents, totalGstCents: row.totalGstCents, totalInclGstCents: row.totalInclGstCents }),
      items: Object.freeze(publicItems), addresses: Object.freeze({ billing: publicAddress("billing"), delivery: publicAddress("delivery") }),
    });
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
      const rows = await database.select({ order: orders }).from(orders).innerJoin(checkoutSessions, and(eq(checkoutSessions.id, orders.checkoutSessionId), eq(checkoutSessions.tokenDigest, tokenDigest), isNotNull(checkoutSessions.completedAt))).where(eq(orders.orderNumber, orderNumber)).limit(1);
      return one(rows.map(({ order }) => order));
    },
    async findByCustomer(orderNumber, customerId) { return one(await database.select().from(orders).where(and(eq(orders.orderNumber, orderNumber), eq(orders.customerId, customerId))).limit(1)); },
    async listByCustomer(customerId) { return hydrate(await database.select().from(orders).where(eq(orders.customerId, customerId)).orderBy(desc(orders.createdAt))); },
  };
}
