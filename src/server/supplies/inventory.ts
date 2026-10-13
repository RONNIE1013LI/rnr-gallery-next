import { ABANDONED_SUPPLY_RESERVATION_MS } from "./reservation-expiry-policy";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import type { RepricedCheckoutCart, SupplyPurchaseSnapshot } from "@/domain/checkout/types";
import type { getDatabase } from "@/server/db/client";
import { suppliesCategories, suppliesProducts, suppliesSettings, suppliesVariants } from "@/server/db/schema/supplies";
import { suppliesStockReservations } from "@/server/db/schema/supplies-inventory";
import { orders } from "@/server/db/schema/orders";
import { AtomicOrderStateError } from "@/server/orders/order-repository";
import { inventoryTransition } from "./inventory-transition";
import { getSupplyPurchaseService } from "./purchase-runtime";

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function orderHasSupplies(order: { pricingSnapshot: unknown }): boolean {
  const snapshot = order.pricingSnapshot as { items?: readonly { kind?: string }[] } | null;
  return snapshot?.items?.some((item) => item.kind === "supply") === true;
}

/** stockQuantity is the sellable balance: reservation deducts, consume never deducts twice. */
export async function reserveSuppliesForOrder(transaction: Transaction, orderId: string, cart: RepricedCheckoutCart, deliveryMethod: "pickup" | "post", now: Date) {
  const items = cart.items.filter((item) => item.kind === "supply");
  if (!items.length) return;
  if (cart.market !== "NZ" || cart.currency !== "NZD") throw new AtomicOrderStateError("Supplies require NZ checkout.");
  // Share locks serialize OFF/publication and price edits against the final purchase check.
  await transaction.select().from(suppliesSettings).for("share");
  await transaction.select().from(suppliesCategories).orderBy(asc(suppliesCategories.id)).for("share");
  const productIds = [...new Set(items.map((item) => item.supplyProductId))].sort();
  await transaction.select().from(suppliesProducts).where(inArray(suppliesProducts.id, productIds)).orderBy(asc(suppliesProducts.id)).for("update");
  await transaction.select().from(suppliesVariants).where(inArray(suppliesVariants.productId, productIds)).orderBy(asc(suppliesVariants.id)).for("update");
  const service = getSupplyPurchaseService(transaction);
  const selections = new Map<string, { snapshot: SupplyPurchaseSnapshot; quantity: number }>();
  for (const item of items) {
    const current = await service.resolve(item.supplyProductId, item.supplyVariantId).catch(() => { throw new AtomicOrderStateError("This supply is unavailable."); });
    if (!isDeepStrictEqual(current, item.supplySnapshot) ||
        (deliveryMethod === "pickup" && !current.pickupAllowed) ||
        (deliveryMethod === "post" && !current.shippingAllowed)) {
      throw new AtomicOrderStateError("Supplies changed before ordering.");
    }
    const key = current.variantId ? `${current.productId}:${current.variantId}` : current.productId;
    const prior = selections.get(key);
    selections.set(key, { snapshot: current, quantity: (prior?.quantity ?? 0) + item.quantity });
  }
  for (const [selectionKey, { snapshot, quantity }] of [...selections].sort(([left], [right]) => left.localeCompare(right))) {
    if (snapshot.trackInventory && !await deductStock(transaction, snapshot.productId, snapshot.variantId, quantity)) {
      throw new AtomicOrderStateError("The selected supply quantity exceeds available stock.");
    }
    await transaction.insert(suppliesStockReservations).values({ orderId, selectionKey,
      productId: snapshot.productId, variantId: snapshot.variantId, quantity,
      tracked: snapshot.trackInventory, status: "reserved", expiresAt: new Date(now.getTime() + ABANDONED_SUPPLY_RESERVATION_MS), createdAt: now, updatedAt: now });
  }
}

async function deductStock(transaction: Transaction, productId: string, variantId: string | null, quantity: number): Promise<boolean> {
  const table = variantId ? suppliesVariants : suppliesProducts;
  const [updated] = await transaction.update(table).set({ stockQuantity: sql`${table.stockQuantity} - ${quantity}` })
    .where(and(eq(table.id, variantId ?? productId), gte(table.stockQuantity, quantity))).returning({ id: table.id });
  return Boolean(updated);
}
async function restoreStock(transaction: Transaction, productId: string, variantId: string | null, quantity: number) {
  const table = variantId ? suppliesVariants : suppliesProducts;
  // Retain outstanding balance even if staff disabled tracking after reservation.
  const [updated] = await transaction.update(table).set({ stockQuantity: sql`coalesce(${table.stockQuantity}, 0) + ${quantity}` })
    .where(eq(table.id, variantId ?? productId)).returning({ id: table.id });
  if (!updated) throw new AtomicOrderStateError("Reserved supply no longer exists.");
}

/** Caller holds the order lock. Financial truth is retained if a late paid result finds a shortage. */
export async function settleSuppliesInventory(transaction: Transaction, order: typeof orders.$inferSelect, payment: string, now: Date, incomingAttemptId?: string): Promise<boolean> {
  if (!orderHasSupplies(order)) return false;
  const selections = await transaction.select({ productId: suppliesStockReservations.productId }).from(suppliesStockReservations)
    .where(eq(suppliesStockReservations.orderId, order.id));
  const productIds = [...new Set(selections.map((selection) => selection.productId))].sort();
  if (productIds.length) {
    // Same product -> variant -> reservation order as purchase/retry prevents mixed-stock deadlocks.
    await transaction.select().from(suppliesProducts).where(inArray(suppliesProducts.id, productIds)).orderBy(asc(suppliesProducts.id)).for("update");
    await transaction.select().from(suppliesVariants).where(inArray(suppliesVariants.productId, productIds)).orderBy(asc(suppliesVariants.id)).for("update");
  }
  const reservations = await transaction.select().from(suppliesStockReservations)
    .where(eq(suppliesStockReservations.orderId, order.id)).orderBy(asc(suppliesStockReservations.selectionKey)).for("update");
  const canRestock = order.shippedAt === null && order.completedAt === null &&
    ["new", "on_hold", "cancelled"].includes(order.fulfilmentStatus);
  let shortage = false;
  for (const reservation of reservations) {
    const transition = inventoryTransition(reservation.status, payment, canRestock, reservation.stockShortage, incomingAttemptId ? { currentAttemptId: reservation.reservedForPaymentAttemptId, incomingAttemptId } : undefined);
    if (!transition) { shortage ||= reservation.stockShortage; continue; }
    let stockShortage = false;
    if (reservation.tracked && transition.stockDelta === "restore" && !reservation.stockShortage) {
      await restoreStock(transaction, reservation.productId, reservation.variantId, reservation.quantity);
    }
    if (reservation.tracked && transition.stockDelta === "reacquire") {
      stockShortage = !await deductStock(transaction, reservation.productId, reservation.variantId, reservation.quantity);
      shortage ||= stockShortage;
    }
    await transaction.update(suppliesStockReservations).set({ status: transition.next, stockShortage, updatedAt: now })
      .where(eq(suppliesStockReservations.id, reservation.id));
  }
  return shortage;
}

export async function assertSupplyOrderPayable(transaction: Transaction, order: typeof orders.$inferSelect) {
  if (!orderHasSupplies(order)) return;
  if (order.fulfilmentStatus === "cancelled") throw new AtomicOrderStateError("This supply order is cancelled.");
  const snapshots = order.pricingSnapshot.items.filter((item) => item.kind === "supply");
  const productIds = [...new Set(snapshots.flatMap((item) => item.supplySnapshot ? [item.supplySnapshot.productId] : []))].sort();
  await transaction.select().from(suppliesSettings).for("share");
  await transaction.select().from(suppliesCategories).orderBy(asc(suppliesCategories.id)).for("share");
  await transaction.select().from(suppliesProducts).where(inArray(suppliesProducts.id, productIds)).orderBy(asc(suppliesProducts.id)).for("update");
  await transaction.select().from(suppliesVariants).where(inArray(suppliesVariants.productId, productIds)).orderBy(asc(suppliesVariants.id)).for("update");
  const service = getSupplyPurchaseService(transaction, true);
  for (const item of snapshots) {
    const snapshot = item.supplySnapshot;
    if (!snapshot) throw new AtomicOrderStateError("Supply order snapshot is unavailable.");
    const current = await service.resolve(snapshot.productId, snapshot.variantId ?? undefined);
    if (current.unitPriceCents !== item.unitPrice.totalInclGstCents ||
        current.weightGrams !== snapshot.weightGrams || current.packedLengthMm !== snapshot.packedLengthMm ||
        current.packedWidthMm !== snapshot.packedWidthMm || current.packedHeightMm !== snapshot.packedHeightMm ||
        (order.deliveryMethod === "pickup" && !current.pickupAllowed) ||
        (order.deliveryMethod === "post" && !current.shippingAllowed)) {
      throw new AtomicOrderStateError("Supply availability changed. Start a new checkout.");
    }
  }
  const now = new Date();
  // A failed payment releases stock. A retry must reserve it again before a new charge begins.
  const reservations = await transaction.select().from(suppliesStockReservations)
    .where(eq(suppliesStockReservations.orderId, order.id)).orderBy(asc(suppliesStockReservations.selectionKey)).for("update");
  for (const reservation of reservations) {
    if (reservation.status !== "released") continue;
    if (reservation.tracked && !await deductStock(transaction, reservation.productId, reservation.variantId, reservation.quantity)) {
      throw new AtomicOrderStateError("The selected supply quantity exceeds available stock.");
    }
    await transaction.update(suppliesStockReservations).set({ status: "reserved", stockShortage: false, expiresAt: new Date(now.getTime() + ABANDONED_SUPPLY_RESERVATION_MS), updatedAt: now })
      .where(eq(suppliesStockReservations.id, reservation.id));
  }
}

/** Called inside the order-locked attempt claim transaction, after the attempt exists. */
export async function bindSuppliesPaymentAttempt(transaction: Transaction, order: typeof orders.$inferSelect, attemptId: string, now: Date) {
  if (!orderHasSupplies(order)) return;
  await transaction.update(suppliesStockReservations).set({ reservedForPaymentAttemptId: attemptId,
    expiresAt: new Date(now.getTime() + ABANDONED_SUPPLY_RESERVATION_MS), updatedAt: now })
    .where(and(eq(suppliesStockReservations.orderId, order.id), eq(suppliesStockReservations.status, "reserved")));
}
export async function suppliesFailureIsCurrent(transaction: Transaction, order: typeof orders.$inferSelect, attemptId: string): Promise<boolean> {
  if (!orderHasSupplies(order)) return true;
  const reservations = await transaction.select({ attemptId: suppliesStockReservations.reservedForPaymentAttemptId }).from(suppliesStockReservations)
    .where(and(eq(suppliesStockReservations.orderId, order.id), eq(suppliesStockReservations.status, "reserved")));
  return reservations.every((reservation) => reservation.attemptId === null || reservation.attemptId === attemptId);
}
