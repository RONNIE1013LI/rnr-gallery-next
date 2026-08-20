import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adminAuditLogs,
  contentEntries,
  customerReviewMedia,
  customerReviews,
  user,
} from "@/server/db/schema";
import { isDedicatedTestDatabase } from "@/server/db/test-database-safety";
import {
  createDrizzleCustomerReviewRepository,
  CUSTOMER_REVIEW_SETTING_KEYS,
} from "./drizzle-customer-review-repository";
import { persistCustomerReviewMutationWithMedia } from "./customer-review-runtime";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(testDatabaseUrl) && isDedicatedTestDatabase(
  testDatabaseUrl,
  process.env.DATABASE_URL,
);
const database = drizzle(testDatabaseUrl ?? "postgres://disabled.invalid/test");
const repository = createDrizzleCustomerReviewRepository(database);
const actorId = "customer-review-integration-admin";
const createdReviewIds: string[] = [];
let priorSettings: (typeof contentEntries.$inferSelect)[] = [];

const actor = (suffix: string) => ({
  userId: actorId,
  email: "customer-review-integration@example.test",
  idempotencyKey: `customer-review-integration-${suffix}`,
  requestSource: "vitest",
});

const input = (displayOrder: number, featured = false) => ({
  reviewerName: `Integration customer ${displayOrder}`,
  originalReviewText: `Public review ${displayOrder}`,
  sourceReviewUrl: "https://www.facebook.com/RandRgallery/reviews/",
  reviewDate: `2026-08-${String(10 + displayOrder).padStart(2, "0")}`,
  recommendationStatus: "RECOMMENDS" as const,
  editorialHeadline: null,
  productKey: null,
  productDisplayLabel: null,
  orderContext: null,
  isHomepageFeatured: featured,
  displayOrder,
  permissionStatus: "GRANTED" as const,
  permissionEvidenceReference: "private evidence",
  permissionNotes: "private note",
  lastVerifiedAt: "2026-08-20T00:00:00.000Z",
  status: "PUBLISHED" as const,
  publishedAt: new Date("2026-08-20T00:00:00.000Z"),
  archivedAt: null,
});

describe.runIf(enabled)("Drizzle customer review repository", () => {
  beforeAll(async () => {
    priorSettings = await database.select().from(contentEntries).where(
      inArray(contentEntries.key, CUSTOMER_REVIEW_SETTING_KEYS),
    );
    await database.delete(contentEntries).where(
      inArray(contentEntries.key, CUSTOMER_REVIEW_SETTING_KEYS),
    );
    await database.insert(user).values({
      id: actorId,
      name: "Review Integration Admin",
      email: "customer-review-integration@example.test",
      role: "admin",
      emailVerified: true,
    }).onConflictDoNothing();
  });

  afterAll(async () => {
    if (createdReviewIds.length) {
      await database.delete(customerReviewMedia).where(
        inArray(customerReviewMedia.reviewId, createdReviewIds),
      );
      await database.delete(customerReviews).where(inArray(customerReviews.id, createdReviewIds));
    }
    await database.delete(adminAuditLogs).where(and(
      eq(adminAuditLogs.actorUserId, actorId),
      inArray(adminAuditLogs.resourceType, ["customer_review", "customer_review_settings"]),
    ));
    await database.delete(contentEntries).where(
      inArray(contentEntries.key, CUSTOMER_REVIEW_SETTING_KEYS),
    );
    if (priorSettings.length) await database.insert(contentEntries).values(priorSettings);
    await database.delete(user).where(eq(user.id, actorId));
  });

  it("orders eligible reviews and returns only the public allowlist", async () => {
    const second = await repository.create(input(2), actor("create-2"));
    const first = await repository.create(input(1, true), actor("create-1"));
    createdReviewIds.push(second.id, first.id);

    const reviews = await repository.listPublic();
    expect(reviews.slice(0, 2).map((review) => review.id)).toEqual([first.id, second.id]);
    expect(JSON.stringify(reviews.slice(0, 2))).not.toMatch(
      /private evidence|private note|permission|storageKey/i,
    );
  });

  it("atomically saves a draft and then publishes the same verified summary", async () => {
    const summary = {
      facebookRating: 5,
      facebookRecommendationCount: 285,
      facebookCountIsApproximate: true,
      facebookReviewsPageUrl: "https://www.facebook.com/RandRgallery/reviews/",
      facebookLastVerifiedAt: "2026-08-20",
    };

    await expect(repository.saveSettings(summary, actor("settings-draft"), false))
      .resolves.toEqual({ draft: summary, published: null });
    await expect(repository.saveSettings(summary, actor("settings-publish"), true))
      .resolves.toEqual({ draft: summary, published: summary });
  });

  it("archives without deleting the record or its private administrative fields", async () => {
    const review = await repository.create(input(3), actor("create-3"));
    createdReviewIds.push(review.id);
    const archived = await repository.archive(
      review.id,
      actor("archive-3"),
      new Date("2026-08-21T00:00:00.000Z"),
    );

    expect(archived).toMatchObject({
      id: review.id,
      status: "ARCHIVED",
      permissionEvidenceReference: "private evidence",
      permissionNotes: "private note",
    });
    expect((await repository.listPublic()).some((item) => item.id === review.id)).toBe(false);
  });

  it("rolls back the review and every media row when one media write fails", async () => {
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#17483c" },
    }).png().toBuffer();
    const file = (name: string) => ({
      name,
      type: "image/png",
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ),
    });
    const saved = [
      {
        id: "transaction-avatar",
        storageKey: "customer-reviews/transaction-collision.png",
        originalName: "avatar.png",
        mimeType: "image/png",
        size: bytes.byteLength,
        sha256: "d".repeat(64),
      },
      {
        id: "transaction-featured",
        storageKey: "customer-reviews/transaction-collision.png",
        originalName: "featured.png",
        mimeType: "image/png",
        size: bytes.byteLength,
        sha256: "e".repeat(64),
      },
    ];
    const removed: string[] = [];
    let saveIndex = 0;

    await expect(persistCustomerReviewMutationWithMedia({
      database,
      actor: actor("transaction-rollback"),
      media: [
        { kind: "AVATAR", file: file("avatar.png") },
        { kind: "FEATURED_IMAGE", file: file("featured.png") },
      ],
      store: {
        save: async () => saved[saveIndex++],
        remove: async (reference) => { removed.push(reference.id); },
      },
      mutate: (service) => service.create(
        input(4),
        actor("transaction-rollback"),
        { publish: true },
      ),
    })).rejects.toBeTruthy();

    const rows = await database.select({ id: customerReviews.id })
      .from(customerReviews)
      .where(eq(customerReviews.reviewerName, "Integration customer 4"));
    expect(rows).toEqual([]);
    expect(removed).toEqual(["transaction-avatar", "transaction-featured"]);
  });
});
