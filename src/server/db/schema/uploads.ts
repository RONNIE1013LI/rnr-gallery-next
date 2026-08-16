import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { checkoutSessions } from "./checkout";
import { orderItems } from "./orders";

export const checkoutUploads = pgTable(
  "checkout_uploads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    checkoutSessionId: uuid("checkout_session_id")
      .notNull()
      .references(() => checkoutSessions.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").unique(),
    originalName: text("original_name"),
    mediaType: text("media_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    sha256: text("sha256"),
    claimedByOrderItemId: uuid("claimed_by_order_item_id"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    cleanupClaimedAt: timestamp("cleanup_claimed_at", { withTimezone: true }),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("checkout_uploads_checkout_session_id_idx").on(table.checkoutSessionId),
    index("checkout_uploads_retention_idx").on(table.purgedAt, table.createdAt),
    foreignKey({
      name: "checkout_uploads_claim_owner_fk",
      columns: [table.checkoutSessionId, table.claimedByOrderItemId],
      foreignColumns: [orderItems.checkoutSessionId, orderItems.id],
    }).onDelete("restrict"),
    check(
      "checkout_uploads_size_bytes_positive",
      sql`${table.sizeBytes} IS NULL OR ${table.sizeBytes} > 0`,
    ),
    check(
      "checkout_uploads_claim_consistent",
      sql`(${table.claimedByOrderItemId} IS NULL AND ${table.claimedAt} IS NULL) OR (${table.claimedByOrderItemId} IS NOT NULL AND ${table.claimedAt} IS NOT NULL)`,
    ),
    check(
      "checkout_uploads_retention_consistent",
      sql`(
        ${table.purgedAt} IS NULL
        AND ${table.storageKey} IS NOT NULL
        AND ${table.originalName} IS NOT NULL
        AND ${table.mediaType} IS NOT NULL
        AND ${table.sizeBytes} IS NOT NULL
        AND ${table.sha256} IS NOT NULL
      ) OR (
        ${table.purgedAt} IS NOT NULL
        AND ${table.claimedByOrderItemId} IS NOT NULL
        AND ${table.storageKey} IS NULL
        AND ${table.originalName} IS NULL
        AND ${table.mediaType} IS NULL
        AND ${table.sizeBytes} IS NULL
        AND ${table.sha256} IS NULL
        AND ${table.cleanupClaimedAt} IS NULL
      )`,
    ),
  ],
);
