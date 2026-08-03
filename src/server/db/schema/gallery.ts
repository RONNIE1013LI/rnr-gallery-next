import { sql } from "drizzle-orm";
import {
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  GalleryOccasionSlug,
  GalleryProductSlug,
  GalleryProductTypeSlug,
  GalleryThemeSlug,
} from "@/domain/gallery/types";
import { user } from "./auth";

export type GalleryDesignStatus = "active" | "trashed";

export type GalleryDesignRevisionSnapshot = Readonly<{
  productTypeSlug: GalleryProductTypeSlug;
  occasionSlug: GalleryOccasionSlug;
  subOccasion: string | null;
  themeSlugs: readonly GalleryThemeSlug[];
  altText: string;
  productSlug: GalleryProductSlug;
  storageKey: string;
  contentHash: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  status: GalleryDesignStatus;
  trashedAt: string | null;
}>;

export const galleryDesigns = pgTable(
  "gallery_designs",
  {
    id: char("id", { length: 64 }).primaryKey(),
    productTypeSlug: text("product_type_slug")
      .$type<GalleryProductTypeSlug>()
      .notNull(),
    occasionSlug: text("occasion_slug").$type<GalleryOccasionSlug>().notNull(),
    subOccasion: text("sub_occasion"),
    themeSlugs: jsonb("theme_slugs")
      .$type<readonly GalleryThemeSlug[]>()
      .notNull(),
    altText: text("alt_text").notNull(),
    productSlug: text("product_slug").$type<GalleryProductSlug>().notNull(),
    storageKey: text("storage_key").notNull(),
    contentHash: char("content_hash", { length: 64 }).notNull(),
    mimeType: text("mime_type")
      .$type<"image/jpeg" | "image/png" | "image/webp">()
      .notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    status: text("status").$type<GalleryDesignStatus>().default("active").notNull(),
    trashedAt: timestamp("trashed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("gallery_designs_storage_key_unique").on(table.storageKey),
    uniqueIndex("gallery_designs_active_content_hash_unique")
      .on(table.contentHash)
      .where(sql`${table.status} = 'active'`),
    index("gallery_designs_public_filters_idx").on(
      table.status,
      table.productTypeSlug,
      table.occasionSlug,
    ),
    index("gallery_designs_updated_at_idx").on(table.updatedAt),
    check(
      "gallery_designs_product_type_valid",
      sql`${table.productTypeSlug} in ('canvas', 'grave-cover', 'roll-up-banner', 'wall-hanging-banners')`,
    ),
    check(
      "gallery_designs_occasion_valid",
      sql`${table.occasionSlug} in ('baby-kids', 'birthday', 'business-promotion', 'family-portrait', 'general-celebration', 'graduation', 'memorial', 'personalised-artwork', 'religious', 'wedding')`,
    ),
    check(
      "gallery_designs_product_slug_valid",
      sql`${table.productSlug} in ('digital-oil-painting-canvas', 'custom-themed-canvas', 'grave-cover', 'roll-up-banner', 'custom-themed-wall-banner')`,
    ),
    check(
      "gallery_designs_product_mapping_valid",
      sql`(
        ${table.productTypeSlug} = 'canvas'
        and ${table.productSlug} in ('digital-oil-painting-canvas', 'custom-themed-canvas')
      ) or (
        ${table.productTypeSlug} = 'grave-cover'
        and ${table.productSlug} = 'grave-cover'
      ) or (
        ${table.productTypeSlug} = 'roll-up-banner'
        and ${table.productSlug} = 'roll-up-banner'
      ) or (
        ${table.productTypeSlug} = 'wall-hanging-banners'
        and ${table.productSlug} = 'custom-themed-wall-banner'
      )`,
    ),
    check(
      "gallery_designs_mime_type_valid",
      sql`${table.mimeType} in ('image/jpeg', 'image/png', 'image/webp')`,
    ),
    check("gallery_designs_width_positive", sql`${table.width} > 0`),
    check("gallery_designs_height_positive", sql`${table.height} > 0`),
    check("gallery_designs_alt_text_present", sql`length(trim(${table.altText})) > 0`),
    check(
      "gallery_designs_content_hash_format",
      sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "gallery_designs_status_valid",
      sql`${table.status} in ('active', 'trashed')`,
    ),
    check(
      "gallery_designs_trashed_at_valid",
      sql`(${table.status} = 'active' and ${table.trashedAt} is null) or (${table.status} = 'trashed' and ${table.trashedAt} is not null)`,
    ),
  ],
);

export const galleryDesignRevisions = pgTable(
  "gallery_design_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    designId: char("design_id", { length: 64 })
      .notNull()
      .references(() => galleryDesigns.id, { onDelete: "restrict" }),
    revisionNumber: integer("revision_number").notNull(),
    priorSnapshot: jsonb("prior_snapshot")
      .$type<GalleryDesignRevisionSnapshot>()
      .notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("gallery_design_revisions_design_revision_unique").on(
      table.designId,
      table.revisionNumber,
    ),
    index("gallery_design_revisions_design_created_idx").on(
      table.designId,
      table.createdAt,
    ),
    check(
      "gallery_design_revisions_number_positive",
      sql`${table.revisionNumber} > 0`,
    ),
  ],
);
