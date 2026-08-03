import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  galleryDesignRevisions,
  galleryDesigns,
  orderItems,
} from "./index";

describe("gallery schema contract", () => {
  it("stores complete current gallery metadata without source paths", () => {
    expect(getTableName(galleryDesigns)).toBe("gallery_designs");
    const columns = getTableConfig(galleryDesigns).columns.map(
      (column) => column.name,
    );

    expect(columns).toEqual(
      expect.arrayContaining([
        "id",
        "product_type_slug",
        "occasion_slug",
        "sub_occasion",
        "theme_slugs",
        "alt_text",
        "product_slug",
        "storage_key",
        "content_hash",
        "mime_type",
        "width",
        "height",
        "status",
        "trashed_at",
      ]),
    );
    expect(columns).not.toContain("source_path");
  });

  it("deduplicates active image contents while retaining trashed history", () => {
    const config = getTableConfig(galleryDesigns);
    const index = config.indexes.find(
      (candidate) =>
        candidate.config.name === "gallery_designs_active_content_hash_unique",
    );

    expect(index?.config.unique).toBe(true);
    expect(index?.config.columns).toHaveLength(1);
    expect(index?.config.columns[0]).toMatchObject({ name: "content_hash" });
    expect(index?.config.where).toBeDefined();
    expect(config.checks.map((check) => check.name)).toContain(
      "gallery_designs_product_mapping_valid",
    );
  });

  it("keeps recoverable prior snapshots in numbered revisions", () => {
    expect(getTableName(galleryDesignRevisions)).toBe(
      "gallery_design_revisions",
    );
    const config = getTableConfig(galleryDesignRevisions);
    expect(config.indexes.map((index) => index.config.name)).toContain(
      "gallery_design_revisions_design_revision_unique",
    );
    expect(
      config.foreignKeys.map((foreignKey) =>
        getTableName(foreignKey.reference().foreignTable),
      ),
    ).toEqual(expect.arrayContaining(["gallery_designs", "user"]));
  });

  it("stores gallery order snapshots as all-null or all-present", () => {
    const config = getTableConfig(orderItems);
    expect(config.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "gallery_design_id",
        "gallery_design_title",
        "gallery_design_content_hash",
        "gallery_design_product_slug",
      ]),
    );
    expect(config.checks.map((check) => check.name)).toContain(
      "order_items_gallery_snapshot_complete",
    );
  });
});
