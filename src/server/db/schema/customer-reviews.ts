import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type {
  CustomerRecommendationStatus,
  CustomerReviewMediaKind,
  CustomerReviewPermissionStatus,
  CustomerReviewStatus,
} from "@/domain/customer-reviews/types";
import { user } from "./auth";

export const customerReviews = pgTable(
  "customer_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourcePlatform: text("source_platform").$type<"FACEBOOK">().default("FACEBOOK").notNull(),
    reviewerName: text("reviewer_name").notNull(),
    originalReviewText: text("original_review_text").notNull(),
    sourceReviewUrl: text("source_review_url"),
    reviewDate: date("review_date").notNull(),
    recommendationStatus: text("recommendation_status")
      .$type<CustomerRecommendationStatus>()
      .default("RECOMMENDS")
      .notNull(),
    editorialHeadline: text("editorial_headline"),
    productKey: text("product_key"),
    productDisplayLabel: text("product_display_label"),
    orderContext: text("order_context"),
    status: text("status").$type<CustomerReviewStatus>().default("DRAFT").notNull(),
    isHomepageFeatured: boolean("is_homepage_featured").default(false).notNull(),
    displayOrder: integer("display_order").default(0).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    permissionStatus: text("permission_status")
      .$type<CustomerReviewPermissionStatus>()
      .default("PENDING")
      .notNull(),
    permissionEvidenceReference: text("permission_evidence_reference"),
    permissionNotes: text("permission_notes"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("customer_reviews_admin_status_idx").on(table.status, table.permissionStatus),
    index("customer_reviews_public_order_idx").on(
      table.status,
      table.permissionStatus,
      table.recommendationStatus,
      table.displayOrder,
      table.reviewDate,
    ),
    index("customer_reviews_product_public_idx").on(table.productKey, table.status),
    uniqueIndex("customer_reviews_one_public_featured_unique")
      .on(table.isHomepageFeatured)
      .where(sql`${table.isHomepageFeatured} = true and ${table.status} = 'PUBLISHED' and ${table.permissionStatus} = 'GRANTED' and ${table.recommendationStatus} = 'RECOMMENDS'`),
    check("customer_reviews_source_platform_valid", sql`${table.sourcePlatform} = 'FACEBOOK'`),
    check(
      "customer_reviews_recommendation_status_valid",
      sql`${table.recommendationStatus} in ('RECOMMENDS', 'DOES_NOT_RECOMMEND', 'LEGACY_STAR_REVIEW')`,
    ),
    check("customer_reviews_status_valid", sql`${table.status} in ('DRAFT', 'PUBLISHED', 'ARCHIVED')`),
    check(
      "customer_reviews_permission_status_valid",
      sql`${table.permissionStatus} in ('PENDING', 'GRANTED', 'REVOKED')`,
    ),
    check(
      "customer_reviews_featured_public_valid",
      sql`${table.isHomepageFeatured} = false or (${table.status} = 'PUBLISHED' and ${table.permissionStatus} = 'GRANTED' and ${table.recommendationStatus} = 'RECOMMENDS')`,
    ),
    check("customer_reviews_display_order_nonnegative", sql`${table.displayOrder} >= 0`),
    check(
      "customer_reviews_publication_timestamps_valid",
      sql`(${table.status} = 'DRAFT' and ${table.publishedAt} is null and ${table.archivedAt} is null) or (${table.status} = 'PUBLISHED' and ${table.publishedAt} is not null and ${table.archivedAt} is null) or (${table.status} = 'ARCHIVED' and ${table.archivedAt} is not null)`,
    ),
    check(
      "customer_reviews_product_pair_valid",
      sql`(${table.productKey} is null and ${table.productDisplayLabel} is null) or (${table.productKey} is not null and ${table.productDisplayLabel} is not null)`,
    ),
    check("customer_reviews_reviewer_name_present", sql`length(trim(${table.reviewerName})) > 0`),
    check("customer_reviews_text_present", sql`length(trim(${table.originalReviewText})) > 0`),
  ],
);

export const customerReviewMedia = pgTable(
  "customer_review_media",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => customerReviews.id, { onDelete: "restrict" }),
    kind: text("kind").$type<CustomerReviewMediaKind>().notNull(),
    storageId: text("storage_id").notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").$type<"image/jpeg" | "image/png" | "image/webp">().notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  },
  (table) => [
    uniqueIndex("customer_review_media_review_kind_unique").on(table.reviewId, table.kind),
    uniqueIndex("customer_review_media_storage_key_unique").on(table.storageKey),
    check(
      "customer_review_media_kind_valid",
      sql`${table.kind} in ('AVATAR', 'FEATURED_IMAGE', 'PERMISSION_EVIDENCE')`,
    ),
    check(
      "customer_review_media_mime_type_valid",
      sql`${table.mimeType} in ('image/jpeg', 'image/png', 'image/webp')`,
    ),
    check("customer_review_media_size_positive", sql`${table.sizeBytes} > 0`),
    check(
      "customer_review_media_dimensions_positive",
      sql`${table.width} > 0 and ${table.height} > 0`,
    ),
    check("customer_review_media_sha256_format", sql`${table.sha256} ~ '^[a-f0-9]{64}$'`),
  ],
);
