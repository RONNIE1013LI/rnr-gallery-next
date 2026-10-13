// @vitest-environment node
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { normalizeAddress } from "@/domain/address/schema";
import { repriceCart } from "@/domain/checkout/reprice-cart";
import { supplySelectionKey } from "@/domain/checkout/types";
import { getSupplyPurchaseService } from "./purchase-runtime";
import { releaseAbandonedSupplyReservations } from "./reservation-expiry";
import { settleSuppliesInventory } from "./inventory";
import { createDrizzleCheckoutRepository } from "@/server/checkout/drizzle-checkout-repository";
import { createDrizzleOrderRepository } from "@/server/orders/drizzle-order-repository";
import { createDrizzlePaymentRepository } from "@/server/payments/drizzle-payment-repository";
import type { OrderRecord } from "@/server/orders/order-repository";
import type { VerifiedPaymentResult } from "@/server/payments/types";
import { checkoutSessions, internalNotificationOutbox, invoiceItems, invoices, orderAddresses, orderItems, orderNotificationOutbox, orders, paymentAttempts, paymentLedgerEntries, productionJobItems, productionJobs, webhookEvents } from "@/server/db/schema";
import { suppliesSettings, suppliesCategories, suppliesProducts, suppliesVariants } from "@/server/db/schema/supplies";
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
    if (!schemaReady) throw new Error("Canonical Supplies schema must be migrated before isolated database acceptance.");
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
        const attempts = await database.select({ id: paymentAttempts.id }).from(paymentAttempts).where(inArray(paymentAttempts.orderId, orderIds));
        if (attempts.length) await database.delete(webhookEvents).where(inArray(webhookEvents.paymentAttemptId, attempts.map(({ id }) => id)));
        await database.delete(paymentLedgerEntries).where(and(inArray(paymentLedgerEntries.orderId, orderIds), eq(paymentLedgerEntries.direction, "debit")));
        await database.delete(paymentLedgerEntries).where(inArray(paymentLedgerEntries.orderId, orderIds));
        await database.delete(paymentAttempts).where(inArray(paymentAttempts.orderId, orderIds));
        await database.delete(orderNotificationOutbox).where(inArray(orderNotificationOutbox.orderId, orderIds));
        await database.delete(internalNotificationOutbox).where(inArray(internalNotificationOutbox.sourceEventId, orderIds));
        const jobs = await database.select({ id: productionJobs.id }).from(productionJobs).where(inArray(productionJobs.orderId, orderIds));
        if (jobs.length) await database.delete(invoices).where(inArray(invoices.jobId, jobs.map(({ id }) => id)));
        await database.delete(productionJobs).where(inArray(productionJobs.orderId, orderIds));
        await database.delete(orderItems).where(inArray(orderItems.orderId, orderIds));
        await database.delete(orderAddresses).where(inArray(orderAddresses.orderId, orderIds));
        await database.delete(orders).where(inArray(orders.id, orderIds));
      }
      if (sessionIds.length) await database.delete(checkoutSessions).where(inArray(checkoutSessions.id, sessionIds));
      await database.delete(suppliesVariants).where(eq(suppliesVariants.productId, productId));
      await database.delete(suppliesProducts).where(eq(suppliesProducts.id, productId));
      await database.delete(suppliesCategories).where(eq(suppliesCategories.id, categoryId));
      if (priorSettings) await database.update(suppliesSettings).set({ enabled: priorSettings.enabled, updatedAt: priorSettings.updatedAt, updatedBy: priorSettings.updatedBy }).where(eq(suppliesSettings.key, "primary"));
      else await database.delete(suppliesSettings).where(eq(suppliesSettings.key, "primary"));
    }
    await pool?.end();
  });
  async function preparedOrder(options: { mixed?: boolean; variantId?: string } = {}) {
    const now = new Date();
    const snapshot = await getSupplyPurchaseService(database!).resolve(productId, options.variantId);
    const cart = repriceCart({ version: 1, items: [
      { kind: "supply", clientItemId: randomUUID(), supplyProductId: productId, ...(options.variantId ? { supplyVariantId: options.variantId } : {}), quantity: 1 },
      ...(options.mixed ? [{ clientItemId: randomUUID(), productKey: "photo-print-canvas", sizeKey: "a4", orientation: "landscape" as const, peoplePets: 0, photoSubmissionMethod: "later" as const, designText: "Synthetic custom artwork", notes: "Synthetic mixed order", neededDate: new Date(now.getTime() + 21 * 86400000).toISOString().slice(0, 10), urgentServiceConfirmed: false, quantity: 1, uploadReferences: [] }] : []),
    ] }, { now, supplies: new Map([[supplySelectionKey(productId, options.variantId), snapshot]]) });
    const checkout = createDrizzleCheckoutRepository(database!);
    const session = await checkout.createSession({ tokenDigest: randomUUID(), customerId: null, expiresAt: new Date(now.getTime() + 86400000) });
    sessionIds.push(session.id);
    const state = await checkout.saveCheckoutState(session.id, { cartDigest: cart.cartDigest, cartSnapshot: cart, billingAddress: address, deliveryAddress: address, deliveryMethod: "pickup" });
    return { sessionId: session.id, expectedCustomerId: null, expectedVersion: state!.version, expectedCartDigest: cart.cartDigest, cart, billingAddress: address, deliveryAddress: address, deliveryMethod: "pickup" as const, shipping: { kind: "pickup" as const }, idempotencyKey: randomUUID(), orderNumber: `RNR-PENDING-${randomUUID()}`, now };
  }
  async function stockOrder() {
    await database!.update(suppliesSettings).set({ enabled: true }).where(eq(suppliesSettings.key, "primary"));
    await database!.update(suppliesProducts).set({ stockQuantity: 1 }).where(eq(suppliesProducts.id, productId));
    return createDrizzleOrderRepository(database!).createAtomicOrder(await preparedOrder());
  }
  function paymentRepository() {
    return createDrizzlePaymentRepository(database!, { websiteAnalyticsV2Enabled: false, onNewInvoiceOrder: () => {} });
  }
  async function paymentAttempt(order: OrderRecord) {
    const repository = paymentRepository();
    const claim = await repository.createOrClaimNonterminalAttempt({ orderId: order.id, provider: "stripe", method: "card", expectedAmountCents: order.totalInclGstCents, currency: "NZD" });
    const providerReference = `synthetic-supplies-${randomUUID()}`;
    await repository.bindProviderSession({ attemptId: claim.attempt.id, claimId: claim.claimId!, providerReference, returnStateDigest: null, status: "processing" });
    const result: VerifiedPaymentResult = { providerReference, providerStatus: "synthetic", amountCents: order.totalInclGstCents, currency: "NZD", orderNumber: order.orderNumber, status: "paid" };
    return { repository, attemptId: claim.attempt.id, result };
  }
  async function inventoryRows(orderId: string) {
    const [product] = await database!.select().from(suppliesProducts).where(eq(suppliesProducts.id, productId));
    const [reservation] = await database!.select().from(suppliesStockReservations).where(eq(suppliesStockReservations.orderId, orderId));
    const [order] = await database!.select().from(orders).where(eq(orders.id, orderId));
    return { product, reservation, order };
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
  it("rejects a stale reviewed price at atomic order creation without deducting stock or creating an order", async () => {
    await database!.update(suppliesSettings).set({ enabled: true }).where(eq(suppliesSettings.key, "primary"));
    await database!.update(suppliesProducts).set({ stockQuantity: 1 }).where(eq(suppliesProducts.id, productId));
    const input = await preparedOrder();
    await database!.update(suppliesProducts).set({ priceCents: 2300 }).where(eq(suppliesProducts.id, productId));
    await expect(createDrizzleOrderRepository(database!).createAtomicOrder(input)).rejects.toThrow();
    const [product] = await database!.select().from(suppliesProducts).where(eq(suppliesProducts.id, productId));
    expect(product.stockQuantity).toBe(1);
    expect(await database!.select().from(orders).where(eq(orders.checkoutSessionId, input.sessionId))).toHaveLength(0);
    await database!.update(suppliesProducts).set({ priceCents: 1150 }).where(eq(suppliesProducts.id, productId));
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

  it.each(["failed", "cancelled"] as const)("releases %s payment stock once, reserves a retry, and ignores duplicate callbacks from the prior attempt", async (status) => {
    const order = await stockOrder();
    const first = await paymentAttempt(order);
    const failure = { attemptId: first.attemptId, result: { ...first.result, status }, source: "reconciliation" as const };
    await first.repository.applyVerifiedResult(failure);
    await first.repository.applyVerifiedResult(failure);
    expect(await inventoryRows(order.id)).toMatchObject({ product: { stockQuantity: 1 }, reservation: { status: "released" }, order: { paymentStatus: status } });
    const retry = await paymentAttempt(order);
    expect(retry.attemptId).not.toBe(first.attemptId);
    expect(await inventoryRows(order.id)).toMatchObject({ product: { stockQuantity: 0 }, reservation: { status: "reserved", reservedForPaymentAttemptId: retry.attemptId } });
    await first.repository.applyVerifiedResult(failure);
    expect(await inventoryRows(order.id)).toMatchObject({ product: { stockQuantity: 0 }, reservation: { status: "reserved", reservedForPaymentAttemptId: retry.attemptId }, order: { paymentStatus: status } });
    const webhook = { provider: "stripe" as const, providerEventId: `synthetic-supplies-${randomUUID()}`, payloadSha256: "a".repeat(64), result: retry.result };
    expect(await retry.repository.applyVerifiedWebhookEventAtomically(webhook)).toBe("applied");
    expect(await retry.repository.applyVerifiedWebhookEventAtomically(webhook)).toBe("duplicate");
    await retry.repository.applyVerifiedResult({ attemptId: retry.attemptId, result: retry.result, source: "reconciliation" });
    expect(await inventoryRows(order.id)).toMatchObject({ product: { stockQuantity: 0 }, reservation: { status: "consumed", stockShortage: false }, order: { paymentStatus: "paid" } });
    expect(await database!.select().from(paymentLedgerEntries).where(eq(paymentLedgerEntries.orderId, order.id))).toHaveLength(1);
    expect(await database!.select().from(orderNotificationOutbox).where(eq(orderNotificationOutbox.orderId, order.id))).toEqual([expect.objectContaining({ kind: "payment_confirmed" })]);
    expect(await database!.select().from(productionJobs).where(eq(productionJobs.orderId, order.id))).toHaveLength(0);
  });

  it("holds a late paid order when another order reserved its released last unit without losing financial truth", async () => {
    const order = await stockOrder();
    const first = await paymentAttempt(order);
    await first.repository.applyVerifiedResult({ attemptId: first.attemptId, result: { ...first.result, status: "failed" }, source: "reconciliation" });
    const other = await createDrizzleOrderRepository(database!).createAtomicOrder(await preparedOrder());
    await first.repository.applyVerifiedResult({ attemptId: first.attemptId, result: first.result, source: "reconciliation" });
    await first.repository.applyVerifiedResult({ attemptId: first.attemptId, result: first.result, source: "reconciliation" });
    expect(await inventoryRows(order.id)).toMatchObject({ product: { stockQuantity: 0 }, reservation: { status: "consumed", stockShortage: true }, order: { paymentStatus: "paid", fulfilmentStatus: "on_hold" } });
    expect(await inventoryRows(other.id)).toMatchObject({ reservation: { status: "reserved", stockShortage: false } });
    expect(await database!.select().from(paymentLedgerEntries).where(eq(paymentLedgerEntries.orderId, order.id))).toHaveLength(1);
  });

  it("preserves staff cancellation history and holds a late paid order even if its unit is reacquired", async () => {
    const order = await stockOrder();
    const first = await paymentAttempt(order);
    const cancelledAt = new Date("2026-10-13T00:00:00.000Z");
    await database!.transaction(async (transaction) => {
      const [locked] = await transaction.update(orders).set({ fulfilmentStatus: "cancelled", cancelledAt }).where(eq(orders.id, order.id)).returning();
      await settleSuppliesInventory(transaction, locked, "cancelled", new Date(), first.attemptId);
    });
    await first.repository.applyVerifiedResult({ attemptId: first.attemptId, result: first.result, source: "reconciliation" });
    expect(await inventoryRows(order.id)).toMatchObject({ product: { stockQuantity: 0 }, reservation: { status: "consumed", stockShortage: false }, order: { paymentStatus: "paid", fulfilmentStatus: "on_hold", cancelledAt } });
  });

  it("refunds an unfulfilled paid order and restores tracked stock exactly once", async () => {
    const order = await stockOrder();
    const payment = await paymentAttempt(order);
    await payment.repository.applyVerifiedResult({ attemptId: payment.attemptId, result: payment.result, source: "reconciliation" });
    const refund = { attemptId: payment.attemptId, result: { ...payment.result, status: "refunded" as const }, source: "reconciliation" as const };
    await payment.repository.applyVerifiedResult(refund);
    await payment.repository.applyVerifiedResult(refund);
    expect(await inventoryRows(order.id)).toMatchObject({ product: { stockQuantity: 1 }, reservation: { status: "restocked" }, order: { paymentStatus: "refunded" } });
    expect(await database!.select().from(paymentLedgerEntries).where(eq(paymentLedgerEntries.orderId, order.id))).toHaveLength(2);
  });

  it("preserves provider-linked stock beyond the abandoned deadline until an authoritative payment result", async () => {
    const order = await stockOrder();
    const payment = await paymentAttempt(order);
    await database!.update(suppliesStockReservations).set({ expiresAt: new Date(0) }).where(eq(suppliesStockReservations.orderId, order.id));
    expect(await releaseAbandonedSupplyReservations(database!)).toBe(0);
    expect(await inventoryRows(order.id)).toMatchObject({ product: { stockQuantity: 0 }, reservation: { status: "reserved" } });
    await payment.repository.applyVerifiedResult({ attemptId: payment.attemptId, result: { ...payment.result, status: "cancelled" }, source: "reconciliation" });
    expect(await inventoryRows(order.id)).toMatchObject({ product: { stockQuantity: 1 }, reservation: { status: "released" } });
  });

  it("takes one payment for a mixed cart while keeping custom production and the combined invoice correct", async () => {
    await database!.update(suppliesSettings).set({ enabled: true }).where(eq(suppliesSettings.key, "primary"));
    await database!.update(suppliesProducts).set({ stockQuantity: 1 }).where(eq(suppliesProducts.id, productId));
    const input = await preparedOrder({ mixed: true });
    const order = await createDrizzleOrderRepository(database!).createAtomicOrder(input);
    expect(await database!.select().from(orderItems).where(eq(orderItems.orderId, order.id))).toEqual([expect.objectContaining({ productKey: "photo-print-canvas" })]);
    expect(await database!.select().from(suppliesOrderItems).where(eq(suppliesOrderItems.orderId, order.id))).toHaveLength(1);
    const payment = await paymentAttempt(order);
    await payment.repository.applyVerifiedResult({ attemptId: payment.attemptId, result: payment.result, source: "reconciliation" });
    const [job] = await database!.select().from(productionJobs).where(eq(productionJobs.orderId, order.id));
    expect(await database!.select().from(productionJobItems).where(eq(productionJobItems.jobId, job.id))).toEqual([expect.objectContaining({ productTitle: "Photo Print Canvas" })]);
    const [invoice] = await database!.select().from(invoices).where(eq(invoices.jobId, job.id));
    expect(invoice).toMatchObject({ currency: "NZD", totalInclGstCents: order.totalInclGstCents });
    expect(await database!.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id))).toEqual(expect.arrayContaining([expect.objectContaining({ code: `SYNTHETIC-${productId}`, lineTotalInclGstCents: 1150 })]));
    expect(await inventoryRows(order.id)).toMatchObject({ product: { stockQuantity: 0 }, reservation: { status: "consumed" }, order: { paymentStatus: "paid" } });
  });

  it("stores NZD/GST and product information snapshots that survive later catalogue edits", async () => {
    const order = await stockOrder();
    const [item] = await database!.select().from(suppliesOrderItems).where(eq(suppliesOrderItems.orderId, order.id));
    const before = (await inventoryRows(order.id)).order.pricingSnapshot;
    expect(item).toMatchObject({ productTitle: "Synthetic stock fixture", unitSubtotalExGstCents: 1000, unitGstCents: 150, unitTotalInclGstCents: 1150 });
    expect(before).toMatchObject({ market: "NZ", currency: "NZD", taxJurisdiction: "NZ_GST", finalTotalCents: 1150 });
    await database!.update(suppliesProducts).set({ title: "Synthetic revised product", priceCents: 2300, sku: `SYNTHETIC-REVISED-${productId}` }).where(eq(suppliesProducts.id, productId));
    const [historical] = await database!.select().from(suppliesOrderItems).where(eq(suppliesOrderItems.orderId, order.id));
    expect(historical).toEqual(item);
    expect((await inventoryRows(order.id)).order.pricingSnapshot).toEqual(before);
  });

  it("admits only one concurrent order for a last variant unit and preserves its SKU and price snapshot", async () => {
    await database!.update(suppliesSettings).set({ enabled: true }).where(eq(suppliesSettings.key, "primary"));
    const variantId = randomUUID();
    const sku = `SYNTHETIC-VARIANT-${variantId}`;
    await database!.insert(suppliesVariants).values({ id: variantId, productId, sku, label: "Synthetic large size", priceCents: 3450, active: true, trackInventory: true, stockQuantity: 1, available: true });
    const first = await preparedOrder({ variantId });
    const second = await preparedOrder({ variantId });
    const repository = createDrizzleOrderRepository(database!);
    const results = await Promise.allSettled([repository.createAtomicOrder(first), repository.createAtomicOrder(second)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const [variant] = await database!.select().from(suppliesVariants).where(eq(suppliesVariants.id, variantId));
    expect(variant.stockQuantity).toBe(0);
    const successful = results.find((result) => result.status === "fulfilled");
    if (successful?.status !== "fulfilled") throw new Error("Expected one successful variant order");
    const [item] = await database!.select().from(suppliesOrderItems).where(eq(suppliesOrderItems.orderId, successful.value.id));
    expect(item).toMatchObject({ unitSubtotalExGstCents: 3000, unitGstCents: 450, unitTotalInclGstCents: 3450, supplySnapshot: { sku, variantId, unitPriceCents: 3450 } });
  });

});
