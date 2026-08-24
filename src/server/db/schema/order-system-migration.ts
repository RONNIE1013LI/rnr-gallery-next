import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { productionJobFiles, productionJobs } from "./production";

export type OrderSystemMigrationState =
  | "pending"
  | "importing"
  | "complete"
  | "failed"
  | "rolled_back";

export type OrderSystemMigrationAttachmentState =
  | "pending"
  | "stored"
  | "bound"
  | "verified"
  | "failed"
  | "rolled_back";

export const orderSystemMigrationJournal = pgTable(
  "order_system_migration_journal",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    migrationVersion: text("migration_version").notNull(),
    legacySource: text("legacy_source").notNull(),
    legacyOrderId: text("legacy_order_id").notNull(),
    sourceRefNo: text("source_ref_no").notNull(),
    sourceDigest: text("source_digest").notNull(),
    targetJobId: uuid("target_job_id").references(() => productionJobs.id, {
      onDelete: "restrict",
    }),
    state: text("state")
      .$type<OrderSystemMigrationState>()
      .default("pending")
      .notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    attachmentExpected: integer("attachment_expected").default(0).notNull(),
    attachmentComplete: integer("attachment_complete").default(0).notNull(),
    attachmentFailed: integer("attachment_failed").default(0).notNull(),
    attachmentSkipped: integer("attachment_skipped").default(0).notNull(),
    safeErrorCode: text("safe_error_code"),
    safeErrorDetail: text("safe_error_detail"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("order_system_migration_journal_legacy_identity_unique").on(
      table.legacySource,
      table.legacyOrderId,
    ),
    uniqueIndex("order_system_migration_journal_target_job_unique")
      .on(table.targetJobId)
      .where(sql`${table.targetJobId} is not null`),
    index("order_system_migration_journal_state_idx").on(table.state),
    check(
      "order_system_migration_journal_source_valid",
      sql`${table.legacySource} = 'rnrgallery-order-system'`,
    ),
    check(
      "order_system_migration_journal_state_valid",
      sql`${table.state} in ('pending', 'importing', 'complete', 'failed', 'rolled_back')`,
    ),
    check(
      "order_system_migration_journal_attempt_count_positive",
      sql`${table.attemptCount} >= 0`,
    ),
    check(
      "order_system_migration_journal_attachment_counts_nonnegative",
      sql`${table.attachmentExpected} >= 0 and ${table.attachmentComplete} >= 0 and ${table.attachmentFailed} >= 0 and ${table.attachmentSkipped} >= 0`,
    ),
    check(
      "order_system_migration_journal_source_digest_valid",
      sql`${table.sourceDigest} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "order_system_migration_journal_safe_error_code_length",
      sql`${table.safeErrorCode} is null or length(${table.safeErrorCode}) <= 100`,
    ),
    check(
      "order_system_migration_journal_safe_error_detail_length",
      sql`${table.safeErrorDetail} is null or length(${table.safeErrorDetail}) <= 1000`,
    ),
  ],
);

export const orderSystemMigrationAttachments = pgTable(
  "order_system_migration_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacySource: text("legacy_source").notNull(),
    legacyAttachmentId: text("legacy_attachment_id").notNull(),
    legacyOrderId: text("legacy_order_id").notNull(),
    sourceSha256: text("source_sha256").notNull(),
    sourceSizeBytes: bigint("source_size_bytes", { mode: "number" }).notNull(),
    sourceMimeType: text("source_mime_type").notNull(),
    outputSha256: text("output_sha256"),
    outputSizeBytes: bigint("output_size_bytes", { mode: "number" }),
    outputMimeType: text("output_mime_type"),
    targetJobId: uuid("target_job_id").references(() => productionJobs.id, {
      onDelete: "restrict",
    }),
    targetFileId: uuid("target_file_id").references(() => productionJobFiles.id, {
      onDelete: "restrict",
    }),
    privateStorageKey: text("private_storage_key"),
    state: text("state")
      .$type<OrderSystemMigrationAttachmentState>()
      .default("pending")
      .notNull(),
    safeErrorCode: text("safe_error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("order_system_migration_attachments_legacy_identity_unique").on(
      table.legacySource,
      table.legacyAttachmentId,
    ),
    index("order_system_migration_attachments_legacy_order_idx").on(
      table.legacySource,
      table.legacyOrderId,
    ),
    index("order_system_migration_attachments_state_idx").on(table.state),
    check(
      "order_system_migration_attachments_source_valid",
      sql`${table.legacySource} = 'rnrgallery-order-system'`,
    ),
    check(
      "order_system_migration_attachments_state_valid",
      sql`${table.state} in ('pending', 'stored', 'bound', 'verified', 'failed', 'rolled_back')`,
    ),
    check(
      "order_system_migration_attachments_source_sha256_valid",
      sql`${table.sourceSha256} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "order_system_migration_attachments_source_size_nonnegative",
      sql`${table.sourceSizeBytes} >= 0`,
    ),
    check(
      "order_system_migration_attachments_output_sha256_valid",
      sql`${table.outputSha256} is null or ${table.outputSha256} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "order_system_migration_attachments_output_size_nonnegative",
      sql`${table.outputSizeBytes} is null or ${table.outputSizeBytes} >= 0`,
    ),
    check(
      "order_system_migration_attachments_safe_error_code_length",
      sql`${table.safeErrorCode} is null or length(${table.safeErrorCode}) <= 100`,
    ),
  ],
);

export type OrderSystemMigrationJournal =
  typeof orderSystemMigrationJournal.$inferSelect;
export type NewOrderSystemMigrationJournal =
  typeof orderSystemMigrationJournal.$inferInsert;
export type OrderSystemMigrationAttachment =
  typeof orderSystemMigrationAttachments.$inferSelect;
export type NewOrderSystemMigrationAttachment =
  typeof orderSystemMigrationAttachments.$inferInsert;
