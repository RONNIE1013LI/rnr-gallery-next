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
  customerReviewMedia,
  customerReviews,
  user,
} from "@/server/db/schema";
import { isDedicatedTestDatabase } from "@/server/db/test-database-safety";
import { createAbandonedUploadCleanup } from "@/server/uploads/abandoned-upload-cleanup";
import { createDrizzleAbandonedUploadCleanupRepository } from "@/server/uploads/drizzle-abandoned-upload-cleanup-repository";
import { LocalPrivateUploadStore } from "@/server/uploads/local-private-upload-store";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(testDatabaseUrl) && isDedicatedTestDatabase(
  testDatabaseUrl,
  process.env.DATABASE_URL,
);
const database = drizzle(testDatabaseUrl ?? "postgres://disabled.invalid/test");
const actorId = `review-retention-${randomUUID()}`;
const reviewId = randomUUID();
const sessionId = randomUUID();
let directory = "";

describe.runIf(enabled)("permanent customer review media retention", () => {
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "rnr-review-retention-"));
    await database.insert(user).values({
      id: actorId,
      name: "Review retention test",
      email: `${actorId}@example.test`,
      role: "admin",
      emailVerified: true,
    });
  });

  afterAll(async () => {
    await database.delete(checkoutUploads).where(eq(checkoutUploads.checkoutSessionId, sessionId));
    await database.delete(checkoutSessions).where(eq(checkoutSessions.id, sessionId));
    await database.delete(customerReviewMedia).where(eq(customerReviewMedia.reviewId, reviewId));
    await database.delete(customerReviews).where(eq(customerReviews.id, reviewId));
    await database.delete(user).where(eq(user.id, actorId));
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("deletes a five-day checkout upload but retains same-age review media after archive and revoke", async () => {
    const store = new LocalPrivateUploadStore(directory);
    const file = (name: string) => ({
      name,
      type: "image/jpeg",
      size: 4,
      arrayBuffer: async () => Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]).buffer,
    });
    const checkoutReference = await store.save(file("checkout.jpg"));
    const reviewReference = await store.save(file("review.jpg"));
    const boundary = new Date("2026-08-01T00:00:00.000Z");
    const now = new Date("2026-08-06T00:00:00.000Z");

    await database.insert(checkoutSessions).values({
      id: sessionId,
      tokenDigest: `review-retention-${randomUUID()}`,
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    });
    await database.insert(checkoutUploads).values({
      id: checkoutReference.id,
      checkoutSessionId: sessionId,
      storageKey: checkoutReference.storageKey,
      originalName: checkoutReference.originalName,
      mediaType: checkoutReference.mimeType,
      sizeBytes: checkoutReference.size,
      sha256: checkoutReference.sha256,
      createdAt: boundary,
    });
    await database.insert(customerReviews).values({
      id: reviewId,
      reviewerName: "Retention customer",
      originalReviewText: "A permanent review image.",
      reviewDate: "2026-08-01",
      status: "PUBLISHED",
      publishedAt: boundary,
      permissionStatus: "GRANTED",
      recommendationStatus: "RECOMMENDS",
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: boundary,
      updatedAt: boundary,
    });
    await database.insert(customerReviewMedia).values({
      reviewId,
      kind: "FEATURED_IMAGE",
      storageId: reviewReference.id,
      storageKey: reviewReference.storageKey,
      mimeType: "image/jpeg",
      sizeBytes: reviewReference.size,
      sha256: reviewReference.sha256,
      width: 1,
      height: 1,
      createdAt: boundary,
      createdBy: actorId,
    });

    const cleanup = createAbandonedUploadCleanup(
      createDrizzleAbandonedUploadCleanupRepository(database),
      store,
    );
    await expect(cleanup.run(100, now)).resolves.toMatchObject({
      removed: 1,
      failed: 0,
    });
    await expect(store.read(checkoutReference.storageKey)).rejects.toThrow();
    await expect(store.read(reviewReference.storageKey)).resolves.toBeDefined();

    await database.update(customerReviews).set({
      status: "ARCHIVED",
      archivedAt: now,
      isHomepageFeatured: false,
    }).where(eq(customerReviews.id, reviewId));
    await expect(store.read(reviewReference.storageKey)).resolves.toBeDefined();

    await database.update(customerReviews).set({ permissionStatus: "REVOKED" })
      .where(eq(customerReviews.id, reviewId));
    await expect(store.read(reviewReference.storageKey)).resolves.toBeDefined();
  });
});
