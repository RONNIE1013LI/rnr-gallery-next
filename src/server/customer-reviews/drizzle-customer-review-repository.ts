import {
  and,
  asc,
  desc,
  eq,
  inArray,
  ne,
  type SQL,
} from "drizzle-orm";

import type {
  AdminCustomerReview,
  AdminCustomerReviewFilter,
  AdminCustomerReviewMedia,
  AdminFacebookReviewSettings,
  CustomerReviewMediaKind,
  FacebookReviewSummaryInput,
  PublicCustomerReview,
} from "@/domain/customer-reviews/types";
import { buildAuditRecord } from "@/server/admin/audit-service";
import type { getDatabase } from "@/server/db/client";
import {
  adminAuditLogs,
  contentEntries,
  customerReviewMedia,
  customerReviews,
} from "@/server/db/schema";
import type {
  CustomerReviewRepository,
  PersistedCustomerReviewInput,
  ReviewActor,
} from "./customer-review-repository";
import type { CustomerReviewMediaRepository } from "./customer-review-media";

type RootDatabase = ReturnType<typeof getDatabase>;
type TransactionDatabase = Parameters<Parameters<RootDatabase["transaction"]>[0]>[0];
export type CustomerReviewDatabase = RootDatabase | TransactionDatabase;
type ReviewRow = typeof customerReviews.$inferSelect;
type MediaRow = typeof customerReviewMedia.$inferSelect;

const SETTINGS_GROUP = "Customer reviews / Facebook summary";
const settingDefinitions = Object.freeze([
  { key: "customer_reviews.facebook.rating", label: "Facebook rating", field: "facebookRating" },
  { key: "customer_reviews.facebook.recommendation_count", label: "Recommendation count", field: "facebookRecommendationCount" },
  { key: "customer_reviews.facebook.count_is_approximate", label: "Approximate count", field: "facebookCountIsApproximate" },
  { key: "customer_reviews.facebook.reviews_page_url", label: "Facebook reviews page URL", field: "facebookReviewsPageUrl" },
  { key: "customer_reviews.facebook.last_verified_at", label: "Last verified date", field: "facebookLastVerifiedAt" },
] as const);

export const CUSTOMER_REVIEW_SETTING_KEYS = Object.freeze(
  settingDefinitions.map((definition) => definition.key),
);

type PublicReviewRow = Readonly<{
  id: string;
  reviewerName: string;
  originalReviewText: string;
  sourceReviewUrl: string | null;
  reviewDate: string;
  editorialHeadline: string | null;
  productKey: string | null;
  productDisplayLabel: string | null;
  orderContext: string | null;
  isHomepageFeatured: boolean;
}>;

type PublicMediaRow = Readonly<{
  kind: CustomerReviewMediaKind;
  mimeType: string;
  width: number;
  height: number;
  storageKey?: string;
}>;

export function buildCustomerReviewMediaAuditRecord(input: Readonly<{
  reviewId: string;
  kind: CustomerReviewMediaKind;
  replacedExisting: boolean;
  actor: ReviewActor;
}>) {
  return buildAuditRecord({
    actorUserId: input.actor.userId,
    actorEmail: input.actor.email,
    action: "customer_review.media_replaced",
    resourceType: "customer_review",
    resourceId: input.reviewId,
    afterSummary: {
      mediaKind: input.kind,
      replacedExisting: input.replacedExisting,
    },
    requestSource: input.actor.requestSource,
    result: "success",
    idempotencyKey: `${input.actor.idempotencyKey}:${input.kind}`,
  });
}

function mediaKindSlug(kind: CustomerReviewMediaKind) {
  return kind.toLowerCase().replaceAll("_", "-");
}

export function mapPublicCustomerReview(
  row: PublicReviewRow,
  media: readonly PublicMediaRow[],
): PublicCustomerReview {
  function publicMedia(kind: "AVATAR" | "FEATURED_IMAGE") {
    const item = media.find((candidate) => candidate.kind === kind);
    if (!item || !["image/jpeg", "image/png", "image/webp"].includes(item.mimeType)) {
      return null;
    }
    return Object.freeze({
      url: `/review-media/${row.id}/${mediaKindSlug(kind)}`,
      mimeType: item.mimeType as "image/jpeg" | "image/png" | "image/webp",
      width: item.width,
      height: item.height,
    });
  }

  return Object.freeze({
    id: row.id,
    reviewerName: row.reviewerName,
    originalReviewText: row.originalReviewText,
    sourceReviewUrl: row.sourceReviewUrl,
    reviewDate: row.reviewDate,
    recommendationStatus: "RECOMMENDS" as const,
    editorialHeadline: row.editorialHeadline,
    productKey: row.productKey,
    productDisplayLabel: row.productDisplayLabel,
    orderContext: row.orderContext,
    isHomepageFeatured: row.isHomepageFeatured,
    avatar: publicMedia("AVATAR"),
    featuredImage: publicMedia("FEATURED_IMAGE"),
  });
}

function toAdminMedia(row: MediaRow): AdminCustomerReviewMedia {
  return Object.freeze({
    id: row.id,
    kind: row.kind,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    adminUrl: `/api/admin/customer-reviews/${row.reviewId}/media/${mediaKindSlug(row.kind)}`,
  });
}

function toAdminReview(row: ReviewRow, media: readonly MediaRow[]): AdminCustomerReview {
  return Object.freeze({
    id: row.id,
    sourcePlatform: row.sourcePlatform,
    reviewerName: row.reviewerName,
    originalReviewText: row.originalReviewText,
    sourceReviewUrl: row.sourceReviewUrl,
    reviewDate: row.reviewDate,
    recommendationStatus: row.recommendationStatus,
    editorialHeadline: row.editorialHeadline,
    productKey: row.productKey,
    productDisplayLabel: row.productDisplayLabel,
    orderContext: row.orderContext,
    status: row.status,
    isHomepageFeatured: row.isHomepageFeatured,
    displayOrder: row.displayOrder,
    publishedAt: row.publishedAt,
    archivedAt: row.archivedAt,
    permissionStatus: row.permissionStatus,
    permissionEvidenceReference: row.permissionEvidenceReference,
    permissionNotes: row.permissionNotes,
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    media: Object.freeze(media.filter((item) => item.reviewId === row.id).map(toAdminMedia)),
  });
}

function databaseValues(input: PersistedCustomerReviewInput, actor: ReviewActor) {
  return {
    reviewerName: input.reviewerName,
    originalReviewText: input.originalReviewText,
    sourceReviewUrl: input.sourceReviewUrl,
    reviewDate: input.reviewDate,
    recommendationStatus: input.recommendationStatus,
    editorialHeadline: input.editorialHeadline,
    productKey: input.productKey,
    productDisplayLabel: input.productDisplayLabel,
    orderContext: input.orderContext,
    status: input.status,
    isHomepageFeatured: input.isHomepageFeatured,
    displayOrder: input.displayOrder,
    publishedAt: input.publishedAt,
    archivedAt: input.archivedAt,
    permissionStatus: input.permissionStatus,
    permissionEvidenceReference: input.permissionEvidenceReference,
    permissionNotes: input.permissionNotes,
    lastVerifiedAt: input.lastVerifiedAt ? new Date(input.lastVerifiedAt) : null,
    updatedBy: actor.userId,
    updatedAt: new Date(),
  };
}

function auditSummary(input: PersistedCustomerReviewInput) {
  return Object.freeze({
    status: input.status,
    permissionStatus: input.permissionStatus,
    recommendationStatus: input.recommendationStatus,
    productKey: input.productKey,
    featured: input.isHomepageFeatured,
    displayOrder: input.displayOrder,
  });
}

function encodeSettings(input: FacebookReviewSummaryInput) {
  return {
    facebookRating: String(input.facebookRating),
    facebookRecommendationCount: String(input.facebookRecommendationCount),
    facebookCountIsApproximate: String(input.facebookCountIsApproximate),
    facebookReviewsPageUrl: input.facebookReviewsPageUrl,
    facebookLastVerifiedAt: input.facebookLastVerifiedAt,
  };
}

function decodeSettings(
  rows: readonly Readonly<{ key: string; draftValue: string; publishedValue: string | null }>[],
  source: "draftValue" | "publishedValue",
): FacebookReviewSummaryInput | null {
  const values = Object.fromEntries(settingDefinitions.map((definition) => {
    const row = rows.find((candidate) => candidate.key === definition.key);
    return [definition.field, row?.[source] ?? null];
  }));
  if (Object.values(values).some((value) => value === null)) return null;
  return Object.freeze({
    facebookRating: Number(values.facebookRating),
    facebookRecommendationCount: Number(values.facebookRecommendationCount),
    facebookCountIsApproximate: values.facebookCountIsApproximate === "true",
    facebookReviewsPageUrl: String(values.facebookReviewsPageUrl),
    facebookLastVerifiedAt: String(values.facebookLastVerifiedAt),
  });
}

export function createDrizzleCustomerReviewRepository(
  database: CustomerReviewDatabase,
): CustomerReviewRepository {
  async function mediaFor(reviewIds: readonly string[]) {
    if (reviewIds.length === 0) return [];
    return database.select().from(customerReviewMedia)
      .where(inArray(customerReviewMedia.reviewId, [...reviewIds]));
  }

  async function findAdmin(id: string) {
    const [row] = await database.select().from(customerReviews)
      .where(eq(customerReviews.id, id)).limit(1);
    if (!row) return null;
    return toAdminReview(row, await mediaFor([id]));
  }

  async function settings(): Promise<AdminFacebookReviewSettings> {
    const rows = await database.select({
      key: contentEntries.key,
      draftValue: contentEntries.draftValue,
      publishedValue: contentEntries.publishedValue,
    }).from(contentEntries).where(inArray(
      contentEntries.key,
      CUSTOMER_REVIEW_SETTING_KEYS,
    ));
    return Object.freeze({
      draft: decodeSettings(rows, "draftValue"),
      published: decodeSettings(rows, "publishedValue"),
    });
  }

  return Object.freeze({
    async listAdmin(filter: AdminCustomerReviewFilter = {}) {
      const conditions: SQL[] = [];
      if (filter.status) conditions.push(eq(customerReviews.status, filter.status));
      if (filter.permissionStatus) {
        conditions.push(eq(customerReviews.permissionStatus, filter.permissionStatus));
      }
      if (filter.featured !== undefined) {
        conditions.push(eq(customerReviews.isHomepageFeatured, filter.featured));
      }
      const query = database.select().from(customerReviews);
      const rows = conditions.length
        ? await query.where(and(...conditions)).orderBy(
          asc(customerReviews.displayOrder),
          desc(customerReviews.reviewDate),
          asc(customerReviews.id),
        )
        : await query.orderBy(
          asc(customerReviews.displayOrder),
          desc(customerReviews.reviewDate),
          asc(customerReviews.id),
        );
      const media = await mediaFor(rows.map((row) => row.id));
      return Object.freeze(rows.map((row) => toAdminReview(row, media)));
    },

    findAdmin,

    async create(input, actor) {
      const id = await database.transaction(async (transaction) => {
        if (input.isHomepageFeatured) {
          await transaction.update(customerReviews)
            .set({ isHomepageFeatured: false, updatedAt: new Date() })
            .where(eq(customerReviews.isHomepageFeatured, true));
        }
        const [created] = await transaction.insert(customerReviews).values({
          ...databaseValues(input, actor),
          createdBy: actor.userId,
        }).returning({ id: customerReviews.id });
        await transaction.insert(adminAuditLogs).values(buildAuditRecord({
          actorUserId: actor.userId,
          actorEmail: actor.email,
          action: "customer_review.created",
          resourceType: "customer_review",
          resourceId: created.id,
          afterSummary: auditSummary(input),
          requestSource: actor.requestSource,
          result: "success",
          idempotencyKey: actor.idempotencyKey,
        }));
        return created.id;
      });
      return (await findAdmin(id))!;
    },

    async update(id, input, actor) {
      const updated = await database.transaction(async (transaction) => {
        const [current] = await transaction.select().from(customerReviews)
          .where(eq(customerReviews.id, id)).for("update").limit(1);
        if (!current) return false;
        if (input.isHomepageFeatured) {
          await transaction.update(customerReviews)
            .set({ isHomepageFeatured: false, updatedAt: new Date() })
            .where(and(
              eq(customerReviews.isHomepageFeatured, true),
              ne(customerReviews.id, id),
            ));
        }
        await transaction.update(customerReviews)
          .set(databaseValues(input, actor))
          .where(eq(customerReviews.id, id));
        await transaction.insert(adminAuditLogs).values(buildAuditRecord({
          actorUserId: actor.userId,
          actorEmail: actor.email,
          action: "customer_review.updated",
          resourceType: "customer_review",
          resourceId: id,
          beforeSummary: {
            status: current.status,
            permissionStatus: current.permissionStatus,
            recommendationStatus: current.recommendationStatus,
            productKey: current.productKey,
            featured: current.isHomepageFeatured,
            displayOrder: current.displayOrder,
          },
          afterSummary: auditSummary(input),
          requestSource: actor.requestSource,
          result: "success",
          idempotencyKey: actor.idempotencyKey,
        }));
        return true;
      });
      return updated ? findAdmin(id) : null;
    },

    async archive(id, actor, archivedAt) {
      const archived = await database.transaction(async (transaction) => {
        const [current] = await transaction.select().from(customerReviews)
          .where(eq(customerReviews.id, id)).for("update").limit(1);
        if (!current) return false;
        await transaction.update(customerReviews).set({
          status: "ARCHIVED",
          isHomepageFeatured: false,
          archivedAt,
          updatedBy: actor.userId,
          updatedAt: archivedAt,
        }).where(eq(customerReviews.id, id));
        await transaction.insert(adminAuditLogs).values(buildAuditRecord({
          actorUserId: actor.userId,
          actorEmail: actor.email,
          action: "customer_review.archived",
          resourceType: "customer_review",
          resourceId: id,
          beforeSummary: { status: current.status, featured: current.isHomepageFeatured },
          afterSummary: { status: "ARCHIVED", featured: false },
          requestSource: actor.requestSource,
          result: "success",
          idempotencyKey: actor.idempotencyKey,
        }));
        return true;
      });
      return archived ? findAdmin(id) : null;
    },

    async listPublic(input = {}) {
      const conditions: SQL[] = [
        eq(customerReviews.status, "PUBLISHED"),
        eq(customerReviews.permissionStatus, "GRANTED"),
        eq(customerReviews.recommendationStatus, "RECOMMENDS"),
      ];
      if (input.productKey) conditions.push(eq(customerReviews.productKey, input.productKey));
      const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
      const rows = await database.select({
        id: customerReviews.id,
        reviewerName: customerReviews.reviewerName,
        originalReviewText: customerReviews.originalReviewText,
        sourceReviewUrl: customerReviews.sourceReviewUrl,
        reviewDate: customerReviews.reviewDate,
        editorialHeadline: customerReviews.editorialHeadline,
        productKey: customerReviews.productKey,
        productDisplayLabel: customerReviews.productDisplayLabel,
        orderContext: customerReviews.orderContext,
        isHomepageFeatured: customerReviews.isHomepageFeatured,
      }).from(customerReviews)
        .where(and(...conditions))
        .orderBy(
          desc(customerReviews.isHomepageFeatured),
          asc(customerReviews.displayOrder),
          desc(customerReviews.reviewDate),
          asc(customerReviews.id),
        )
        .limit(limit);
      if (rows.length === 0) return Object.freeze([]);
      const media = await database.select({
        reviewId: customerReviewMedia.reviewId,
        kind: customerReviewMedia.kind,
        mimeType: customerReviewMedia.mimeType,
        width: customerReviewMedia.width,
        height: customerReviewMedia.height,
      }).from(customerReviewMedia).where(and(
        inArray(customerReviewMedia.reviewId, rows.map((row) => row.id)),
        inArray(customerReviewMedia.kind, ["AVATAR", "FEATURED_IMAGE"]),
      ));
      return Object.freeze(rows.map((row) => mapPublicCustomerReview(
        row,
        media.filter((item) => item.reviewId === row.id),
      )));
    },

    getSettings: settings,

    async saveSettings(input, actor, publish) {
      const encoded = encodeSettings(input);
      await database.transaction(async (transaction) => {
        const now = new Date();
        for (const definition of settingDefinitions) {
          const value = encoded[definition.field];
          await transaction.insert(contentEntries).values({
            key: definition.key,
            groupName: SETTINGS_GROUP,
            label: definition.label,
            draftValue: value,
            draftUpdatedBy: actor.userId,
            ...(publish ? {
              publishedValue: value,
              publishedBy: actor.userId,
              publishedAt: now,
            } : {}),
          }).onConflictDoUpdate({
            target: contentEntries.key,
            set: {
              draftValue: value,
              draftUpdatedBy: actor.userId,
              updatedAt: now,
              ...(publish ? {
                publishedValue: value,
                publishedBy: actor.userId,
                publishedAt: now,
              } : {}),
            },
          });
        }
        await transaction.insert(adminAuditLogs).values(buildAuditRecord({
          actorUserId: actor.userId,
          actorEmail: actor.email,
          action: publish
            ? "customer_review_settings.published"
            : "customer_review_settings.draft_saved",
          resourceType: "customer_review_settings",
          resourceId: "facebook",
          afterSummary: { fieldCount: settingDefinitions.length, published: publish },
          requestSource: actor.requestSource,
          result: "success",
          idempotencyKey: actor.idempotencyKey,
        }));
      });
      return settings();
    },
  });
}

export function createDrizzleCustomerReviewMediaRepository(
  database: CustomerReviewDatabase,
): CustomerReviewMediaRepository {
  return Object.freeze({
    async replace(input) {
      return database.transaction(async (transaction) => {
        const [old] = await transaction.select({
          id: customerReviewMedia.storageId,
          storageKey: customerReviewMedia.storageKey,
        }).from(customerReviewMedia).where(and(
          eq(customerReviewMedia.reviewId, input.reviewId),
          eq(customerReviewMedia.kind, input.kind),
        )).for("update").limit(1);

        await transaction.insert(customerReviewMedia).values({
          reviewId: input.reviewId,
          kind: input.kind,
          storageId: input.storageId,
          storageKey: input.storageKey,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          sha256: input.sha256,
          width: input.width,
          height: input.height,
          createdBy: input.actor.userId,
        }).onConflictDoUpdate({
          target: [customerReviewMedia.reviewId, customerReviewMedia.kind],
          set: {
            storageId: input.storageId,
            storageKey: input.storageKey,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            sha256: input.sha256,
            width: input.width,
            height: input.height,
            createdBy: input.actor.userId,
            createdAt: new Date(),
          },
        });
        await transaction.insert(adminAuditLogs).values(
          buildCustomerReviewMediaAuditRecord({
            reviewId: input.reviewId,
            kind: input.kind,
            replacedExisting: Boolean(old),
            actor: input.actor,
          }),
        );
        return old ?? null;
      });
    },

    async findPublic(reviewId, kind) {
      const [record] = await database.select({
        storageKey: customerReviewMedia.storageKey,
        mimeType: customerReviewMedia.mimeType,
      }).from(customerReviewMedia)
        .innerJoin(customerReviews, eq(customerReviews.id, customerReviewMedia.reviewId))
        .where(and(
          eq(customerReviewMedia.reviewId, reviewId),
          eq(customerReviewMedia.kind, kind),
          eq(customerReviews.status, "PUBLISHED"),
          eq(customerReviews.permissionStatus, "GRANTED"),
          eq(customerReviews.recommendationStatus, "RECOMMENDS"),
        )).limit(1);
      return record ?? null;
    },

    async findAdmin(reviewId, kind) {
      const [record] = await database.select({
        storageKey: customerReviewMedia.storageKey,
        mimeType: customerReviewMedia.mimeType,
      }).from(customerReviewMedia).where(and(
        eq(customerReviewMedia.reviewId, reviewId),
        eq(customerReviewMedia.kind, kind),
      )).limit(1);
      return record ?? null;
    },
  });
}
