import { and, asc, eq, inArray, lte, notInArray, sql } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import { orders } from "@/server/db/schema/orders";
import { paymentAttempts, paymentAttemptCoreColumns } from "@/server/db/schema/payments";
import { flikCheckoutSessions } from "@/server/db/schema/flik";
import { suppliesStockReservations } from "@/server/db/schema/supplies-inventory";
import { canExpireSupplyReservation } from "./reservation-expiry-policy";
import { settleSuppliesInventory } from "./inventory";
import { invalidateSuppliesInventory } from "./inventory-cache";
import { isMissingSuppliesSchema } from "./errors";

type Database = ReturnType<typeof getDatabase>;
/** Bounded lazy recovery on actual Supplies requests. No timer, cron, or polling. */
export async function releaseAbandonedSupplyReservations(database?: Database, limit = 20): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError("Invalid supply reservation recovery limit.");
  if (!database && !process.env.DATABASE_URL?.trim()) return 0;
  try {
    const reader = database ?? getDatabase();
    const candidates = await reader.selectDistinct({ orderId: suppliesStockReservations.orderId }).from(suppliesStockReservations)
      .innerJoin(orders, eq(orders.id, suppliesStockReservations.orderId))
      .where(and(eq(suppliesStockReservations.status, "reserved"), sql`${suppliesStockReservations.expiresAt} <= clock_timestamp()`,
        notInArray(orders.paymentStatus, ["paid", "refunded"]),
        sql`not exists (select 1 from ${paymentAttempts} as live_attempt
          where live_attempt.order_id = ${orders.id} and live_attempt.status in ('created', 'requires_action', 'processing')
          and (live_attempt.provider_reference is not null or live_attempt.provider_session_lease_expires_at > clock_timestamp()))`,
        sql`not exists (select 1 from ${flikCheckoutSessions} as live_flik where live_flik.order_id = ${orders.id}
          and live_flik.applied_at is null and (live_flik.provider_reference is not null or live_flik.creation_lease_expires_at > clock_timestamp()))`))
      .orderBy(asc(suppliesStockReservations.orderId)).limit(limit);
    let released = 0;
    for (const candidate of candidates) {
      const changed = await reader.transaction(async (transaction) => {
        const [order] = await transaction.select().from(orders).where(eq(orders.id, candidate.orderId)).for("update", { skipLocked: true }).limit(1);
        if (!order) return false;
        const clock = await transaction.execute<{ now: Date }>(sql`select clock_timestamp() as "now"`);
        const now = new Date(clock.rows[0].now);
        // Order -> attempts/Flik -> parent products -> variants -> reservations matches all payment paths.
        const attempts = await transaction.select(paymentAttemptCoreColumns).from(paymentAttempts).where(eq(paymentAttempts.orderId, order.id)).for("update");
        const flikSessions = await transaction.select().from(flikCheckoutSessions).where(eq(flikCheckoutSessions.orderId, order.id)).for("update");
        const reservations = await transaction.select().from(suppliesStockReservations)
          .where(and(eq(suppliesStockReservations.orderId, order.id), eq(suppliesStockReservations.status, "reserved")));
        if (!reservations.length || !reservations.every((reservation) => canExpireSupplyReservation({ ...reservation, paymentStatus: order.paymentStatus, attempts, flikSessions }, now))) return false;
        await settleSuppliesInventory(transaction, order, "cancelled", now);
        await transaction.update(suppliesStockReservations).set({ expiredAt: now })
          .where(and(eq(suppliesStockReservations.orderId, order.id), inArray(suppliesStockReservations.id, reservations.map(({ id }) => id)), lte(suppliesStockReservations.expiresAt, now)));
        return true;
      });
      if (changed) released += 1;
    }
    if (released) invalidateSuppliesInventory();
    return released;
  } catch (error) {
    if (isMissingSuppliesSchema(error)) return 0;
    throw error;
  }
}
