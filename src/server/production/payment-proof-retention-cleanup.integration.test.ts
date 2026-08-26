import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminAuditLogs, productionJobFiles, productionJobs } from "@/server/db/schema";
import { isDedicatedTestDatabase } from "@/server/db/test-database-safety";
import { LocalPrivateUploadStore } from "@/server/uploads/local-private-upload-store";
import { createDrizzlePaymentProofRetentionRepository } from "./drizzle-payment-proof-retention-repository";
import { createPaymentProofRetentionCleanup } from "./payment-proof-retention-cleanup";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
const hasDedicatedTestDatabase = isDedicatedTestDatabase(
  testDatabaseUrl,
  process.env.DATABASE_URL,
);
const database = drizzle(testDatabaseUrl);
const jobIds = Array.from({ length: 5 }, () => randomUUID());
let directory = "";

describe.runIf(hasDedicatedTestDatabase)("payment-proof retention persistence", () => {
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "rnr-payment-proof-retention-"));
  });

  afterAll(async () => {
    await database.delete(adminAuditLogs).where(and(
      eq(adminAuditLogs.resourceType, "production_job"),
      inArray(adminAuditLogs.resourceId, jobIds),
    ));
    await database.delete(productionJobs).where(inArray(productionJobs.id, jobIds));
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("deletes only seven-day-old proofs for jobs that remain Arrive", async () => {
    const store = new LocalPrivateUploadStore(directory);
    const references = await Promise.all(
      ["eligible", "recent-arrival", "recent-upload", "other", "fallback"].map((name) =>
        store.save({
          name: `${name}.jpg`,
          type: "image/jpeg",
          size: 4,
          arrayBuffer: async () => Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]).buffer,
        }),
      ),
    );
    const now = new Date("2026-08-26T00:00:00Z");
    const eightDaysAgo = new Date("2026-08-18T00:00:00Z");
    const sixDaysAgo = new Date("2026-08-20T00:00:00Z");

    await database.insert(productionJobs).values(jobIds.map((id, index) => ({
      id,
      jobNumber: `RETENTION-${randomUUID()}`,
      source: "manual" as const,
      idempotencyKey: randomUUID(),
      requestDigest: "a".repeat(64),
      customerName: "Retention Test",
      customerEmail: "retention@example.invalid",
      customerPhone: "",
      customerSource: "other" as const,
      manualStatus: "new" as const,
      manualPaymentStatus: "paid" as const,
      urgent: false,
      neededDate: "2026-08-30",
      deliveryMethod: "other" as const,
      paymentReconciliationStatus: index === 3 ? "Other" as const : "Arrive" as const,
      amountPayableCents: 0,
      amountPaidCents: 0,
      artistFeeCents: 0,
      materialCostCents: 0,
      createdAt: eightDaysAgo,
      updatedAt: index === 4 ? eightDaysAgo : now,
    })));
    await database.insert(productionJobFiles).values(references.map((reference, index) => ({
      id: reference.id,
      jobId: jobIds[index],
      kind: "payment_proof" as const,
      originalName: reference.originalName,
      mediaType: reference.mimeType,
      sizeBytes: reference.size,
      storageKey: reference.storageKey,
      sha256: reference.sha256,
      idempotencyKey: randomUUID(),
      requestDigest: "b".repeat(64),
      createdAt: index === 2 ? sixDaysAgo : eightDaysAgo,
    })));
    await database.insert(adminAuditLogs).values(jobIds.slice(0, 4).map((jobId, index) => ({
      actorUserId: "retention-test",
      actorEmail: "retention@example.invalid",
      action: "production_job.updated",
      resourceType: "production_job",
      resourceId: jobId,
      afterSummary: {
        changes: [{
          field: "paymentReconciliationStatus",
          before: "Not checked",
          after: "Arrive",
        }],
      },
      requestSource: "test",
      result: "success" as const,
      idempotencyKey: randomUUID(),
      createdAt: index === 1 ? sixDaysAgo : eightDaysAgo,
    })));

    const cleanup = createPaymentProofRetentionCleanup(
      createDrizzlePaymentProofRetentionRepository(database),
      store,
    );
    await expect(cleanup.report(now)).resolves.toEqual({ eligible: 2, eligibleBytes: 8 });
    await expect(cleanup.run(100, now)).resolves.toEqual({
      examined: 2,
      deleted: 2,
      skipped: 0,
      failed: 0,
    });

    await expect(database.select().from(productionJobFiles)
      .where(inArray(productionJobFiles.id, [references[0].id, references[4].id])))
      .resolves.toHaveLength(0);
    await expect(database.select().from(productionJobFiles)
      .where(inArray(productionJobFiles.id, [references[1].id, references[2].id, references[3].id])))
      .resolves.toHaveLength(3);
    await expect(store.read(references[0].storageKey)).rejects.toThrow();
    await expect(store.read(references[4].storageKey)).rejects.toThrow();
    await expect(store.read(references[1].storageKey)).resolves.toBeDefined();

    const deletionAudits = await database.select().from(adminAuditLogs).where(and(
      eq(adminAuditLogs.action, "production_file.retention_deleted"),
      inArray(adminAuditLogs.resourceId, jobIds),
    ));
    expect(deletionAudits).toHaveLength(2);
    expect(deletionAudits.every((audit) =>
      !JSON.stringify(audit.beforeSummary).includes(".jpg")
    )).toBe(true);
  });
});
