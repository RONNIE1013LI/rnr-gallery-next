import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  orderNumberSequence,
  orderSystemMigrationAttachments,
  orderSystemMigrationJournal,
} from "./index";

describe("historical order migration schema", () => {
  it("exports both Production-applied historical migration tables", () => {
    expect([
      orderSystemMigrationJournal,
      orderSystemMigrationAttachments,
    ].map(getTableName)).toEqual([
      "order_system_migration_journal",
      "order_system_migration_attachments",
    ]);
  });

  it("records each source order once without source payloads", () => {
    expect(orderSystemMigrationJournal.legacyOrderId.name).toBe("legacy_order_id");
    expect(getTableColumns(orderSystemMigrationJournal)).toEqual(
      expect.objectContaining({
        migrationVersion: expect.anything(),
        legacySource: expect.anything(),
        legacyOrderId: expect.anything(),
        sourceRefNo: expect.anything(),
        sourceDigest: expect.anything(),
        targetJobId: expect.anything(),
        state: expect.anything(),
        attemptCount: expect.anything(),
        attachmentExpected: expect.anything(),
        attachmentComplete: expect.anything(),
        attachmentFailed: expect.anything(),
        attachmentSkipped: expect.anything(),
        safeErrorCode: expect.anything(),
        safeErrorDetail: expect.anything(),
        startedAt: expect.anything(),
        completedAt: expect.anything(),
        updatedAt: expect.anything(),
      }),
    );
    expect(Object.keys(getTableColumns(orderSystemMigrationJournal))).not.toEqual(
      expect.arrayContaining(["customerPayload", "sourcePath", "credentials"]),
    );
  });

  it("records each attachment once and binds targets restrictively", () => {
    expect(orderSystemMigrationAttachments.legacyAttachmentId.name)
      .toBe("legacy_attachment_id");
    expect(getTableColumns(orderSystemMigrationAttachments)).toEqual(
      expect.objectContaining({
        legacySource: expect.anything(),
        legacyAttachmentId: expect.anything(),
        legacyOrderId: expect.anything(),
        sourceSha256: expect.anything(),
        sourceSizeBytes: expect.anything(),
        sourceMimeType: expect.anything(),
        outputSha256: expect.anything(),
        outputSizeBytes: expect.anything(),
        outputMimeType: expect.anything(),
        targetJobId: expect.anything(),
        targetFileId: expect.anything(),
        privateStorageKey: expect.anything(),
        state: expect.anything(),
        safeErrorCode: expect.anything(),
        startedAt: expect.anything(),
        completedAt: expect.anything(),
        updatedAt: expect.anything(),
      }),
    );
    expect(getTableConfig(orderSystemMigrationAttachments).foreignKeys.map((key) => key.onDelete))
      .toEqual(["restrict", "restrict"]);
  });

  it("limits state values, retry counters and legacy identity uniqueness", () => {
    expect(getTableConfig(orderSystemMigrationJournal).checks.map((check) => check.name))
      .toEqual(expect.arrayContaining([
        "order_system_migration_journal_source_valid",
        "order_system_migration_journal_state_valid",
        "order_system_migration_journal_attempt_count_positive",
        "order_system_migration_journal_attachment_counts_nonnegative",
      ]));
    expect(getTableConfig(orderSystemMigrationAttachments).checks.map((check) => check.name))
      .toEqual(expect.arrayContaining([
        "order_system_migration_attachments_source_valid",
        "order_system_migration_attachments_state_valid",
        "order_system_migration_attachments_source_size_nonnegative",
        "order_system_migration_attachments_output_size_nonnegative",
      ]));
    expect(getTableConfig(orderSystemMigrationJournal).indexes.map((item) => item.config.name))
      .toEqual(expect.arrayContaining([
        "order_system_migration_journal_legacy_identity_unique",
        "order_system_migration_journal_target_job_unique",
      ]));
    expect(getTableConfig(orderSystemMigrationAttachments).indexes.map((item) => item.config.name))
      .toContain("order_system_migration_attachments_legacy_identity_unique");
  });

  it("matches the applied order-number sequence definition", () => {
    expect(orderNumberSequence.seqName).toBe("rnr_order_number_seq");
    expect(orderNumberSequence.schema).toBeUndefined();
    expect(orderNumberSequence.seqOptions).toEqual({
      increment: 1,
      minValue: 1,
      startWith: 1,
    });
  });
});
