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
    storageKey: text("storage_key").notNull().unique(),
    originalName: text("original_name").notNull(),
    mediaType: text("media_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    claimedByOrderItemId: uuid("claimed_by_order_item_id").unique(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("checkout_uploads_checkout_session_id_idx").on(table.checkoutSessionId),
    foreignKey({
      name: "checkout_uploads_claim_owner_fk",
      columns: [table.checkoutSessionId, table.claimedByOrderItemId],
      foreignColumns: [orderItems.checkoutSessionId, orderItems.id],
    }).onDelete("restrict"),
    check("checkout_uploads_size_bytes_positive", sql`${table.sizeBytes} > 0`),
    check(
      "checkout_uploads_claim_consistent",
      sql`(${table.claimedByOrderItemId} IS NULL AND ${table.claimedAt} IS NULL) OR (${table.claimedByOrderItemId} IS NOT NULL AND ${table.claimedAt} IS NOT NULL)`,
    ),
  ],
);
