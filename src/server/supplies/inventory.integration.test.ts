// @vitest-environment node
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { normalizeAddress } from "@/domain/address/schema";
import { repriceCart } from "@/domain/checkout/reprice-cart";
import { getSupplyPurchaseService } from "./purchase-runtime";
import { releaseAbandonedSupplyReservations } from "./reservation-expiry";
import { settleSuppliesInventory } from "./inventory";
import { createDrizzleCheckoutRepository } from "@/server/checkout/drizzle-checkout-repository";
import { createDrizzleOrderRepository } from "@/server/orders/drizzle-order-repository";
import { checkoutSessions, orderAddresses, orders } from "@/server/db/schema";
import { suppliesSettings, suppliesCategories, suppliesProducts } from "@/server/db/schema/supplies";
import { suppliesOrderItems, suppliesStockReservations } from "@/server/db/schema/supplies-inventory";

vi.mock("./inventory-cache", () => ({ invalidateSuppliesInventory: vi.fn() }));
// Never creates a table or runs a migration. Global Vitest bootstrap verifies TEST_DATABASE_URL identity.
const databaseUrl = process.env.TEST_DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const database = pool ? drizzle(pool) : null;
const productId = randomUUID();
const categoryId = randomUUID();
const sessionIds: string[] = [];
let schemaReady = false;
let priorSettings: typeof suppliesSettings.$inferSelect | undefined;
const address = normalizeAddress({ country: "NZ", fullName: "Synthetic Supplies Test", building: "", street: "12 Queen Street", suburb: "Auckland Central", region: "Auckland", postcode: "1010", phone: "0211234567", email: "supplies-fixture@example.test" });

describe.skipIf(!databaseUrl)("supplies stock on a verified isolated database with existing canonical schema", () => {
  beforeAll(async () => {
    const databaseName = decodeURIComponent(new URL(databaseUrl!).pathname.slice(1));
    if (!/^rnr_gallery_test_release_gate_[a-f0-9]{8}_[a-z0-9_]{6,12}_integration$/.test(databaseName)) {
      throw new Error("BLOCKED: Supply inventory writes require a session-specific release-gate disposable database.");
    }
    const result = await pool!.query<{ ready: boolean }>("select to_regclass('supplies_stock_reservations') is not null and to_regclass('supplies_order_items') is not null and to_regclass('supplies_products') is not null and exists (select 1 from information_schema.columns where table_name = 'supplies_stock_reservations' and column_name = 'expires_at') and exists (select 1 from information_schema.columns where table_name = 'supplies_stock_reservations' and column_name = 'reserved_for_payment_attempt_id') as ready");
    schemaReady = result.rows[0]?.ready === true;
    if (!schemaReady) return;
    [priorSettings] = await database!.select().from(suppliesSettings).where(eq(suppliesSettings.key, "primary"));
    await database!.insert(suppliesSettings).values({ key: "primary", enabled: true }).onConflictDoUpdate({ target: suppliesSettings.key, set: { enabled: true } });
    await database!.insert(suppliesCategories).values({ id: categoryId, name: "Synthetic test category", slug: `synthetic-${categoryId}`, visible: true });
    await database!.insert(suppliesProducts).values({ id: productId, categoryId, title: "Synthetic stock fixture", slug: `synthetic-${productId}`, sku: `SYNTHETIC-${productId}`, status: "published", priceCents: 1150, trackInventory: true, stockQuantity: 1, available: true, pickupAllowed: true });
  });
  afterAll(async () => {
    if (schemaReady && database) {
      const orderRows = sessionIds.length ? await database.select({ id: orders.id }).from(orders).where(inArray(orders.checkoutSessionId, sessionIds)) : [];
      const orderIds = orderRows.map(({ id }) => id);
      if (orderIds.length) {
        await database.delete(suppliesStockReservations).where(inArray(suppliesStockReservations.orderId, orderIds));
        await database.delete(suppliesOrderItems).where(inArray(suppliesOrderItems.orderId, orderIds));
        await database.delete(orderAddresses).where(inArray(orderAddresses.orderId, orderIds));
        await database.delete(orders).where(inArray(orders.id, orderIds));
      }
      if (sessionIds.length) await database.delete(checkoutSessions).where(inArray(checkoutSessions.id, sessionIds));
      await database.delete(suppliesProducts).where(eq(suppliesProducts.id, productId));
      await database.delete(suppliesCategories).where(eq(suppliesCategories.id, categoryId));
      if (priorSettings) await database.update(suppliesSettings).set({ enabled: priorSettings.enabled, updatedAt: priorSettings.updatedAt, updatedBy: priorSettings.updatedBy }).where(eq(suppliesSettings.key, "primary"));
      else await database.delete(suppliesSettings).where(eq(suppliesSettings.key, "primary"));
    }
    await pool?.end();
  });
  async function preparedOrder() {
    const now = new Date();
    const snapshot = await getSupplyPurchaseService(database!).resolve(productId);
    const cart = repriceCart({ version: 1, items: [{ kind: "supply", clientItemId: randomUUID(), supplyProductId: productId, quantity: 1 }] }, { now, supplies: new Map([[productId, snapshot]]) });
    const checkout = createDrizzleCheckoutRepository(database!);
    const session = await checkout.createSession({ tokenDigest: randomUUID(), customerId: null, expiresAt: new Date(now.getTime() + 86400000) });
    sessionIds.push(session.id);
    const state = await checkout.saveCheckoutState(session.id, { cartDigest: cart.cartDigest, cartSnapshot: cart, billingAddress: address, deliveryAddress: address, deliveryMethod: "pickup" });
    return { sessionId: session.id, expectedCustomerId: null, expectedVersion: state!.version, expectedCartDigest: cart.cartDigest, cart, billingAddress: address, deliveryAddress: address, deliveryMethod: "pickup" as const, shipping: { kind: "pickup" as const }, idempotencyKey: randomUUID(), orderNumber: `RNR-PENDING-${randomUUID()}`, now };
  }
  it("admits only one of two simultaneous orders for the last unit and consumes it once", async (context) => {
    if (!schemaReady) { context.skip(true, "BLOCKED: Supplies canonical schema is absent; migration freeze remains active."); return; }
    const first = await preparedOrder();
    const second = await preparedOrder();
    const repository = createDrizzleOrderRepository(database!);
    const results = await Promise.allSettled([repository.createAtomicOrder(first), repository.createAtomicOrder(second)]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const [product] = await database!.select().from(suppliesProducts).where(eq(suppliesProducts.id, productId));
    expect(product.stockQuantity).toBe(0);
    const [reservation] = await database!.select().from(suppliesStockReservations).where(eq(suppliesStockReservations.productId, productId));
    const [order] = await database!.select().from(orders).where(eq(orders.id, reservation.orderId));
    await database!.transaction(async (transaction) => { await transaction.select().from(orders).where(eq(orders.id, order.id)).for("update"); await settleSuppliesInventory(transaction, order, "paid", new Date()); await settleSuppliesInventory(transaction, order, "paid", new Date()); });
    const [consumed] = await database!.select().from(suppliesStockReservations).where(eq(suppliesStockReservations.id, reservation.id));
    const [after] = await database!.select().from(suppliesProducts).where(eq(suppliesProducts.id, productId));
    expect(consumed.status).toBe("consumed");
    expect(after.stockQuantity).toBe(0);
  });
  it("rejects a reviewed checkout when the store is switched OFF before atomic order creation", async (context) => {
    if (!schemaReady) { context.skip(true, "BLOCKED: Supplies canonical schema is absent."); return; }
    await database!.update(suppliesProducts).set({ stockQuantity: 1 }).where(eq(suppliesProducts.id, productId));
    const input = await preparedOrder();
    await database!.update(suppliesSettings).set({ enabled: false }).where(eq(suppliesSettings.key, "primary"));
    await expect(createDrizzleOrderRepository(database!).createAtomicOrder(input)).rejects.toThrow();
    const [product] = await database!.select().from(suppliesProducts).where(eq(suppliesProducts.id, productId));
    expect(product.stockQuantity).toBe(1);
    const created = await database!.select().from(orders).where(and(eq(orders.checkoutSessionId, input.sessionId), eq(orders.idempotencyKey, input.idempotencyKey)));
    expect(created).toHaveLength(0);
  });
  it("automatically reopens abandoned pre-payment stock at its deadline and releases it once", async (context) => {
    if (!schemaReady) { context.skip(true, "BLOCKED: Supplies canonical schema/expiry fields are absent."); return; }
    await database!.update(suppliesSettings).set({ enabled: true }).where(eq(suppliesSettings.key, "primary"));
    await database!.update(suppliesProducts).set({ stockQuantity: 1 }).where(eq(suppliesProducts.id, productId));
    const order = await createDrizzleOrderRepository(database!).createAtomicOrder(await preparedOrder());
    await database!.update(suppliesStockReservations).set({ expiresAt: new Date(0) }).where(eq(suppliesStockReservations.orderId, order.id));
    expect(await releaseAbandonedSupplyReservations(database!)).toBe(1);
    expect(await releaseAbandonedSupplyReservations(database!)).toBe(0);
    const [available] = await database!.select().from(suppliesProducts).where(eq(suppliesProducts.id, productId));
    const [released] = await database!.select().from(suppliesStockReservations).where(eq(suppliesStockReservations.orderId, order.id));
    expect(available.stockQuantity).toBe(1);
    expect(released.status).toBe("released");
    expect(released.expiredAt).toBeInstanceOf(Date);
    await database!.transaction(async (transaction) => {
      const [locked] = await transaction.select().from(orders).where(eq(orders.id, order.id)).for("update");
      expect(await settleSuppliesInventory(transaction, locked, "paid", new Date())).toBe(false);
      expect(await settleSuppliesInventory(transaction, locked, "paid", new Date())).toBe(false);
    });
    const [paidStock] = await database!.select().from(suppliesProducts).where(eq(suppliesProducts.id, productId));
    expect(paidStock.stockQuantity).toBe(0);
  });

});
