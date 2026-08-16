import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  checkoutSessions,
  checkoutUploads,
  orderItems,
  orders,
} from "@/server/db/schema";
import { isDedicatedTestDatabase } from "@/server/db/test-database-safety";
import { createAbandonedUploadCleanup } from "./abandoned-upload-cleanup";
import { createDrizzleAbandonedUploadCleanupRepository } from "./drizzle-abandoned-upload-cleanup-repository";
import { LocalPrivateUploadStore } from "./local-private-upload-store";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
const hasDedicatedTestDatabase = isDedicatedTestDatabase(
  testDatabaseUrl,
  process.env.DATABASE_URL,
);
const database = drizzle(testDatabaseUrl);
const sessionId = randomUUID();
const orderId = randomUUID();
const orderItemId = randomUUID();
let directory = "";

describe.runIf(hasDedicatedTestDatabase)("source-photo cleanup persistence", () => {
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "rnr-upload-cleanup-"));
  });

  afterAll(async () => {
    await database.delete(checkoutUploads).where(eq(checkoutUploads.checkoutSessionId, sessionId));
    await database.delete(orderItems).where(eq(orderItems.orderId, orderId));
    await database.delete(orders).where(eq(orders.id, orderId));
    await database.delete(checkoutSessions).where(eq(checkoutSessions.id, sessionId));
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("reports without mutation and purges bound and unbound uploads at 120 hours", async () => {
    const store = new LocalPrivateUploadStore(directory);
    const references = await Promise.all(
      ["unbound", "bound", "young", "live-claim", "stale-claim"].map((name) =>
        store.save({
          name: `${name}.jpg`,
          type: "image/jpeg",
          size: 4,
          arrayBuffer: async () => Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]).buffer,
        }),
      ),
    );
    const [unbound, bound, young, liveClaim, staleClaim] = references;
    const now = new Date("2026-08-06T00:00:00Z");
    const boundary = new Date("2026-08-01T00:00:00Z");
    await database.insert(checkoutSessions).values({
      id: sessionId,
      tokenDigest: `cleanup-${randomUUID()}`,
      expiresAt: new Date("2099-01-01T00:00:00Z"),
    });
    await database.insert(orders).values({
      id: orderId,
      orderNumber: `RETENTION-${randomUUID()}`,
      checkoutSessionId: sessionId,
      checkoutSessionVersion: 1,
      idempotencyKey: randomUUID(),
      customerEmail: "retention-test@example.invalid",
      pricingSnapshot: {} as (typeof orders.$inferInsert)["pricingSnapshot"],
      deliveryMethod: "pickup",
      shippingServiceCode: "pickup",
      shippingServiceName: "Pickup",
      productSubtotalExGstCents: 0,
      productGstCents: 0,
      productTotalInclGstCents: 0,
      shippingExGstCents: 0,
      shippingGstCents: 0,
      shippingTotalInclGstCents: 0,
      totalExGstCents: 0,
      totalGstCents: 0,
      totalInclGstCents: 0,
    });
    await database.insert(orderItems).values({
      id: orderItemId,
      checkoutSessionId: sessionId,
      orderId,
      position: 0,
      clientItemId: randomUUID(),
      productKey: "retention-test",
      productSlug: "retention-test",
      productTitle: "Retention Test",
      sizeKey: "test",
      sizeLabel: "Test",
      peoplePets: 1,
      photoSubmissionMethod: "upload",
      designText: "",
      notes: "",
      neededDate: "",
      urgentServiceConfirmed: false,
      urgentWorkingDays: 1,
      quantity: 1,
      priceLines: [],
      uploadReferences: [bound.id],
      unitSubtotalExGstCents: 0,
      unitGstCents: 0,
      unitTotalInclGstCents: 0,
      lineSubtotalExGstCents: 0,
      lineGstCents: 0,
      lineTotalInclGstCents: 0,
    });
    await database.insert(checkoutUploads).values(references.map((reference) => ({
      id: reference.id,
      checkoutSessionId: sessionId,
      storageKey: reference.storageKey,
      originalName: reference.originalName,
      mediaType: reference.mimeType,
      sizeBytes: reference.size,
      sha256: reference.sha256,
      createdAt: reference.id === young.id
        ? new Date("2026-08-01T00:01:00Z")
        : boundary,
      cleanupClaimedAt: reference.id === liveClaim.id
        ? new Date(Date.now() - 5 * 60 * 1_000)
        : reference.id === staleClaim.id
          ? new Date(Date.now() - 16 * 60 * 1_000)
          : null,
    })));
    await database.update(checkoutUploads).set({
      claimedByOrderItemId: orderItemId,
      claimedAt: boundary,
    }).where(eq(checkoutUploads.id, bound.id));

    const repository = createDrizzleAbandonedUploadCleanupRepository(database);
    const cleanup = createAbandonedUploadCleanup(
      repository,
      store,
    );

    await expect(cleanup.report(now)).resolves.toEqual({
      eligible: 3,
      eligibleBytes: 12,
    });
    await expect(database.select().from(checkoutUploads)
      .where(eq(checkoutUploads.checkoutSessionId, sessionId))).resolves.toHaveLength(5);

    await expect(cleanup.run(100, now)).resolves.toEqual({
      examined: 3,
      removed: 3,
      tombstoned: 1,
      failed: 0,
      sessionsDeleted: 0,
    });
    await expect(database.select().from(checkoutUploads)
      .where(eq(checkoutUploads.id, unbound.id))).resolves.toHaveLength(0);
    await expect(database.select().from(checkoutUploads)
      .where(eq(checkoutUploads.id, staleClaim.id))).resolves.toHaveLength(0);
    const [tombstone] = await database.select().from(checkoutUploads)
      .where(eq(checkoutUploads.id, bound.id));
    expect(tombstone).toMatchObject({
      claimedByOrderItemId: orderItemId,
      storageKey: null,
      originalName: null,
      mediaType: null,
      sizeBytes: null,
      sha256: null,
      cleanupClaimedAt: null,
      purgedAt: now,
    });
    await expect(database.select().from(checkoutUploads)
      .where(eq(checkoutUploads.id, young.id))).resolves.toHaveLength(1);
    await expect(database.select().from(checkoutUploads)
      .where(eq(checkoutUploads.id, liveClaim.id))).resolves.toHaveLength(1);
    await expect(store.read(unbound.storageKey)).rejects.toThrow();
    await expect(store.read(bound.storageKey)).rejects.toThrow();
    await expect(store.read(staleClaim.storageKey)).rejects.toThrow();
    await expect(store.read(young.storageKey)).resolves.toBeDefined();
    await expect(store.read(liveClaim.storageKey)).resolves.toBeDefined();
  });
});
