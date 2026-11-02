import { sql } from "drizzle-orm";
import { bigint, check, index, jsonb, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import type { CartSnapshotItem, CartSnapshotStage } from "@/domain/analytics/cart-snapshot";
import { websiteAnalyticsSessions } from "./analytics";

/** Browser-entered estimates, not payment or authoritative checkout totals. */
export const websiteAnalyticsCartSnapshots = pgTable("website_analytics_cart_snapshots", {
  id: uuid("id").primaryKey(),
  sessionId: uuid("session_id").notNull()
    .references(() => websiteAnalyticsSessions.id, { onDelete: "cascade" }),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  stage: varchar("stage", { length: 16 }).$type<CartSnapshotStage>().notNull(),
  currency: varchar("currency", { length: 3 }).$type<"NZD" | "AUD">().notNull(),
  totalInclGstCents: bigint("total_incl_gst_cents", { mode: "number" }).notNull(),
  items: jsonb("items").$type<readonly CartSnapshotItem[]>().notNull(),
  fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
}, (table) => [
  index("website_analytics_cart_snapshots_session_time_idx").on(table.sessionId, table.occurredAt),
  check("website_analytics_cart_snapshots_currency_valid", sql`${table.currency} in ('NZD','AUD')`),
  check("website_analytics_cart_snapshots_stage_valid", sql`${table.stage} in ('cart','checkout')`),
  check("website_analytics_cart_snapshots_total_nonnegative", sql`${table.totalInclGstCents} >= 0`),
]);
