import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { SupplyStatus } from "@/domain/supplies/types";
import { user } from "./auth";

const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
});
const packaging = () => ({
  weightGrams: integer("weight_grams"), packedLengthMm: integer("packed_length_mm"),
  packedWidthMm: integer("packed_width_mm"), packedHeightMm: integer("packed_height_mm"),
});
const inventory = () => ({
  trackInventory: boolean("track_inventory").default(false).notNull(),
  stockQuantity: integer("stock_quantity"), available: boolean("available").default(false).notNull(),
});

export const suppliesSettings = pgTable("supplies_settings", {
  key: text("key").primaryKey().default("primary"), enabled: boolean("enabled").default(false).notNull(),
  market: text("market").default("NZ").notNull(), currency: text("currency").default("NZD").notNull(),
  updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }), ...timestamps(),
}, (table) => [
  check("supplies_settings_singleton", sql`${table.key} = 'primary'`),
  check("supplies_settings_nz_only", sql`${table.market} = 'NZ' and ${table.currency} = 'NZD'`),
]);

export const suppliesCategories = pgTable("supplies_categories", {
  id: uuid("id").defaultRandom().primaryKey(), name: text("name").notNull(), slug: text("slug").notNull(),
  description: text("description").default("").notNull(), sortOrder: integer("sort_order").default(0).notNull(),
  visible: boolean("visible").default(false).notNull(), archived: boolean("archived").default(false).notNull(), ...timestamps(),
}, (table) => [
  uniqueIndex("supplies_categories_slug_unique").on(table.slug),
  check("supplies_categories_slug_valid", sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  check("supplies_categories_name_present", sql`length(trim(${table.name})) > 0`),
  check("supplies_categories_sort_order_valid", sql`${table.sortOrder} >= 0`),
]);

export const suppliesProducts = pgTable("supplies_products", {
  id: uuid("id").defaultRandom().primaryKey(), categoryId: uuid("category_id").notNull().references(() => suppliesCategories.id, { onDelete: "restrict" }),
  title: text("title").notNull(), slug: text("slug").notNull(), sku: text("sku").notNull(),
  shortDescription: text("short_description").default("").notNull(), description: text("description").default("").notNull(),
  status: text("status").$type<SupplyStatus>().default("draft").notNull(), priceCents: integer("price_cents").notNull(), salePriceCents: integer("sale_price_cents"),
  ...packaging(), ...inventory(), pickupAllowed: boolean("pickup_allowed").default(true).notNull(), shippingAllowed: boolean("shipping_allowed").default(false).notNull(),
  seoTitle: text("seo_title").default("").notNull(), seoDescription: text("seo_description").default("").notNull(),
  sortOrder: integer("sort_order").default(0).notNull(), featured: boolean("featured").default(false).notNull(), ...timestamps(),
}, (table) => [
  uniqueIndex("supplies_products_slug_unique").on(table.slug), uniqueIndex("supplies_products_sku_unique").on(sql`lower(${table.sku})`),
  index("supplies_products_category_status_idx").on(table.categoryId, table.status),
  check("supplies_products_slug_valid", sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  check("supplies_products_status_valid", sql`${table.status} in ('draft', 'published', 'archived')`),
  check("supplies_products_price_valid", sql`${table.priceCents} between 0 and 100000000 and (${table.salePriceCents} is null or (${table.salePriceCents} > 0 and ${table.salePriceCents} < ${table.priceCents}))`),
  check("supplies_products_inventory_valid", sql`(${table.stockQuantity} is null or ${table.stockQuantity} >= 0) and (not ${table.trackInventory} or ${table.stockQuantity} is not null)`),
  check("supplies_products_packaging_valid", sql`(${table.weightGrams} is null or ${table.weightGrams} > 0) and (${table.packedLengthMm} is null or ${table.packedLengthMm} > 0) and (${table.packedWidthMm} is null or ${table.packedWidthMm} > 0) and (${table.packedHeightMm} is null or ${table.packedHeightMm} > 0)`),
  check("supplies_products_title_sku_present", sql`length(trim(${table.title})) > 0 and length(trim(${table.sku})) > 0`),
]);

export const suppliesVariants = pgTable("supplies_variants", {
  id: uuid("id").defaultRandom().primaryKey(), productId: uuid("product_id").notNull().references(() => suppliesProducts.id, { onDelete: "restrict" }),
  sku: text("sku").notNull(), label: text("label").notNull(), options: jsonb("options").$type<Record<string, string>>().default({}).notNull(),
  priceCents: integer("price_cents").notNull(), salePriceCents: integer("sale_price_cents"), active: boolean("active").default(true).notNull(),
  archived: boolean("archived").default(false).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(), ...packaging(), ...inventory(), ...timestamps(),
}, (table) => [
  uniqueIndex("supplies_variants_sku_unique").on(sql`lower(${table.sku})`), index("supplies_variants_product_idx").on(table.productId),
  check("supplies_variants_price_valid", sql`${table.priceCents} between 0 and 100000000 and (${table.salePriceCents} is null or (${table.salePriceCents} > 0 and ${table.salePriceCents} < ${table.priceCents}))`),
  check("supplies_variants_inventory_valid", sql`(${table.stockQuantity} is null or ${table.stockQuantity} >= 0) and (not ${table.trackInventory} or ${table.stockQuantity} is not null)`),
  check("supplies_variants_options_object", sql`jsonb_typeof(${table.options}) = 'object'`),
  check("supplies_variants_packaging_valid", sql`(${table.weightGrams} is null or ${table.weightGrams} > 0) and (${table.packedLengthMm} is null or ${table.packedLengthMm} > 0) and (${table.packedWidthMm} is null or ${table.packedWidthMm} > 0) and (${table.packedHeightMm} is null or ${table.packedHeightMm} > 0)`),
]);

export const suppliesImages = pgTable("supplies_images", {
  id: uuid("id").defaultRandom().primaryKey(), productId: uuid("product_id").references(() => suppliesProducts.id, { onDelete: "restrict" }),
  categoryId: uuid("category_id").references(() => suppliesCategories.id, { onDelete: "restrict" }),
  storageKey: text("storage_key").notNull(), altText: text("alt_text").notNull(), width: integer("width").notNull(), height: integer("height").notNull(),
  byteLength: integer("byte_length").notNull(), contentHash: text("content_hash").notNull(), mimeType: text("mime_type").default("image/webp").notNull(),
  sortOrder: integer("sort_order").default(0).notNull(), isCover: boolean("is_cover").default(false).notNull(),
  detachedAt: timestamp("detached_at", { withTimezone: true }), ...timestamps(),
}, (table) => [
  uniqueIndex("supplies_images_storage_unique").on(table.storageKey),
  uniqueIndex("supplies_images_product_cover_unique").on(table.productId).where(sql`${table.isCover} and ${table.detachedAt} is null`),
  uniqueIndex("supplies_images_category_unique").on(table.categoryId).where(sql`${table.detachedAt} is null`),
  index("supplies_images_product_idx").on(table.productId),
  check("supplies_images_owner_valid", sql`(${table.detachedAt} is null and ((${table.productId} is not null and ${table.categoryId} is null) or (${table.productId} is null and ${table.categoryId} is not null))) or (${table.detachedAt} is not null and ${table.productId} is null and ${table.categoryId} is null and not ${table.isCover})`),
  check("supplies_images_dimensions_valid", sql`${table.width} > 0 and ${table.height} > 0 and ${table.byteLength} > 0`),
  check("supplies_images_type_valid", sql`${table.mimeType} = 'image/webp'`),
  check("supplies_images_storage_valid", sql`${table.storageKey} ~ '^supplies/[a-f0-9-]+/[a-f0-9-]+[.]webp$'`),
]);

export const suppliesAuditLogs = pgTable("supplies_audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(), actorUserId: text("actor_user_id").notNull(), action: text("action").notNull(),
  resourceType: text("resource_type").notNull(), resourceId: text("resource_id").notNull(),
  beforeSummary: jsonb("before_summary").$type<Record<string, unknown>>(), afterSummary: jsonb("after_summary").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("supplies_audit_resource_idx").on(table.resourceType, table.resourceId), index("supplies_audit_created_idx").on(table.createdAt)]);
