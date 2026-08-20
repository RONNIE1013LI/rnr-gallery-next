import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { customerReviewMedia, customerReviews } from "./index";

function columnNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).columns.map((column) => column.name);
}

describe("customer reviews schema", () => {
  it("stores the approved review workflow without deletion or retention fields", () => {
    expect(getTableName(customerReviews)).toBe("customer_reviews");
    expect(columnNames(customerReviews)).toEqual(expect.arrayContaining([
      "id",
      "source_platform",
      "reviewer_name",
      "original_review_text",
      "source_review_url",
      "review_date",
      "recommendation_status",
      "editorial_headline",
      "product_key",
      "product_display_label",
      "order_context",
      "status",
      "is_homepage_featured",
      "display_order",
      "published_at",
      "archived_at",
      "permission_status",
      "permission_evidence_reference",
      "permission_notes",
      "last_verified_at",
      "created_by",
      "updated_by",
      "created_at",
      "updated_at",
    ]));
    expect(columnNames(customerReviews)).not.toEqual(expect.arrayContaining([
      "expires_at",
      "cleanup_claimed_at",
      "purged_at",
      "deleted_at",
    ]));
  });

  it("enforces public, status, and Featured invariants", () => {
    const config = getTableConfig(customerReviews);
    expect(config.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "customer_reviews_source_platform_valid",
      "customer_reviews_recommendation_status_valid",
      "customer_reviews_status_valid",
      "customer_reviews_permission_status_valid",
      "customer_reviews_featured_public_valid",
      "customer_reviews_display_order_nonnegative",
      "customer_reviews_publication_timestamps_valid",
      "customer_reviews_product_pair_valid",
    ]));

    const featured = config.indexes.find(
      (index) => index.config.name === "customer_reviews_one_public_featured_unique",
    );
    expect(featured?.config.unique).toBe(true);
    expect(featured?.config.where).toBeDefined();
    expect(featured?.config.columns).toHaveLength(1);
  });

  it("stores permanent private media separately with one row per kind", () => {
    expect(getTableName(customerReviewMedia)).toBe("customer_review_media");
    expect(columnNames(customerReviewMedia)).toEqual(expect.arrayContaining([
      "id",
      "review_id",
      "kind",
      "storage_id",
      "storage_key",
      "mime_type",
      "size_bytes",
      "sha256",
      "width",
      "height",
      "created_at",
      "created_by",
    ]));
    expect(columnNames(customerReviewMedia)).not.toEqual(expect.arrayContaining([
      "expires_at",
      "cleanup_claimed_at",
      "purged_at",
      "deleted_at",
    ]));

    const config = getTableConfig(customerReviewMedia);
    expect(config.indexes.map((index) => index.config.name)).toEqual(expect.arrayContaining([
      "customer_review_media_review_kind_unique",
      "customer_review_media_storage_key_unique",
    ]));
    expect(config.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "customer_review_media_kind_valid",
      "customer_review_media_size_positive",
      "customer_review_media_dimensions_positive",
      "customer_review_media_sha256_format",
    ]));
  });
});
