import { sql } from "drizzle-orm";
import {
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
import { user } from "./auth";
import { orders, type OrderFulfilmentStatus } from "./orders";
import type { ProductRegistryDocument } from "@/domain/catalogue/product-registry";

export type AuditResult = "success" | "failure";
export type AuditSummary = Readonly<Record<string, unknown>>;
export type OrderNoteVisibility = "internal" | "customer";

export const adminAuditLogs = pgTable(
  "admin_audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: text("actor_user_id").notNull(),
    actorEmail: text("actor_email").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    beforeSummary: jsonb("before_summary").$type<AuditSummary>(),
    afterSummary: jsonb("after_summary").$type<AuditSummary>(),
    requestSource: text("request_source"),
    result: text("result").$type<AuditResult>().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("admin_audit_actor_action_idempotency_unique").on(
      table.actorUserId,
      table.action,
      table.idempotencyKey,
    ),
    index("admin_audit_created_at_idx").on(table.createdAt),
    index("admin_audit_resource_idx").on(table.resourceType, table.resourceId),
    check("admin_audit_actor_email_present", sql`length(trim(${table.actorEmail})) > 0`),
    check("admin_audit_action_present", sql`length(trim(${table.action})) > 0`),
    check("admin_audit_resource_type_present", sql`length(trim(${table.resourceType})) > 0`),
    check("admin_audit_result_valid", sql`${table.result} in ('success', 'failure')`),
  ],
);

export const orderNotes = pgTable(
  "order_notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    authorUserId: text("author_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    visibility: text("visibility").$type<OrderNoteVisibility>().notNull(),
    body: text("body").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("order_notes_order_idempotency_unique").on(
      table.orderId,
      table.idempotencyKey,
    ),
    index("order_notes_order_created_idx").on(table.orderId, table.createdAt),
    check("order_notes_visibility_valid", sql`${table.visibility} in ('internal', 'customer')`),
    check("order_notes_body_present", sql`length(trim(${table.body})) > 0`),
  ],
);

export const orderStatusHistory = pgTable(
  "order_status_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    fromStatus: text("from_status").$type<OrderFulfilmentStatus>().notNull(),
    toStatus: text("to_status").$type<OrderFulfilmentStatus>().notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    reason: text("reason"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("order_status_history_order_idempotency_unique").on(
      table.orderId,
      table.idempotencyKey,
    ),
    index("order_status_history_order_created_idx").on(
      table.orderId,
      table.createdAt,
    ),
    check("order_status_history_changes_status", sql`${table.fromStatus} <> ${table.toStatus}`),
  ],
);

export const contentEntries = pgTable(
  "content_entries",
  {
    key: text("key").primaryKey(),
    groupName: text("group_name").notNull(),
    label: text("label").notNull(),
    draftValue: text("draft_value").notNull(),
    publishedValue: text("published_value"),
    draftUpdatedBy: text("draft_updated_by").references(() => user.id, {
      onDelete: "set null",
    }),
    publishedBy: text("published_by").references(() => user.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("content_entries_group_idx").on(table.groupName),
    check("content_entries_key_present", sql`length(trim(${table.key})) > 0`),
    check("content_entries_group_present", sql`length(trim(${table.groupName})) > 0`),
    check("content_entries_label_present", sql`length(trim(${table.label})) > 0`),
    check(
      "content_entries_publish_pair_valid",
      sql`(${table.publishedValue} is null and ${table.publishedAt} is null and ${table.publishedBy} is null) or (${table.publishedValue} is not null and ${table.publishedAt} is not null and ${table.publishedBy} is not null)`,
    ),
  ],
);

export const productRegistryCurrent = pgTable(
  "product_registry_current",
  {
    registryKey: text("registry_key").primaryKey(),
    revision: integer("revision").notNull(),
    snapshot: jsonb("snapshot").$type<ProductRegistryDocument>().notNull(),
    publishedBy: text("published_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("product_registry_current_key_valid", sql`${table.registryKey} = 'primary'`),
    check("product_registry_current_revision_positive", sql`${table.revision} > 0`),
  ],
);

export const productRegistryRevisions = pgTable(
  "product_registry_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    registryKey: text("registry_key").notNull(),
    revision: integer("revision").notNull(),
    snapshot: jsonb("snapshot").$type<ProductRegistryDocument>().notNull(),
    publishedBy: text("published_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("product_registry_revisions_key_revision_unique").on(
      table.registryKey,
      table.revision,
    ),
    index("product_registry_revisions_published_at_idx").on(table.publishedAt),
    check("product_registry_revisions_key_valid", sql`${table.registryKey} = 'primary'`),
    check("product_registry_revisions_revision_positive", sql`${table.revision} > 0`),
  ],
);
