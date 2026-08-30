import { describe, expect, it, vi } from "vitest";
import { databaseHostFingerprint } from "./migration-safety";
import {
  parseWebsiteAnalyticsV2BackfillArguments,
  runWebsiteAnalyticsV2BackfillCommand,
} from "./backfill-website-analytics-v2";

const testUrl = "postgresql://tester:secret@test-db.example/rnr_gallery_test";
const productionUrl = "postgresql://runtime:secret@production-db.example/neondb";
const productionFingerprint = databaseHostFingerprint("production-db.example");

describe("Website Analytics V2 backfill command", () => {
  it("parses only bounded, explicit command arguments", () => {
    expect(parseWebsiteAnalyticsV2BackfillArguments([
      "--environment", "test",
      "--dry-run",
      "--batch-size", "25",
      "--source", "website_orders",
      "--source", "ledger_events",
      "--from", "2025-01-02T03:04:05.000Z",
    ])).toEqual({
      environment: "test",
      dryRun: true,
      batchSize: 25,
      sources: ["website_orders", "ledger_events"],
      fromOccurredAt: new Date("2025-01-02T03:04:05.000Z"),
      confirmProduction: false,
    });
    expect(() => parseWebsiteAnalyticsV2BackfillArguments([
      "--environment", "test", "--batch-size", "0",
    ])).toThrow(/between 1 and 500/i);
    expect(() => parseWebsiteAnalyticsV2BackfillArguments([
      "--environment", "test", "--source", "orders_with_customer_email",
    ])).toThrow(/source/i);
    expect(() => parseWebsiteAnalyticsV2BackfillArguments([
      "--environment", "test", "--unknown",
    ])).toThrow(/unknown/i);
  });

  it("refuses Production unless the existing confirmation and exact identity gates pass", async () => {
    const execute = vi.fn();
    const identifyDatabase = vi.fn().mockResolvedValue({
      database: "neondb",
      hostname: "production-db.example",
      serverVersion: "PostgreSQL 17",
      inRecovery: false,
    });
    await expect(runWebsiteAnalyticsV2BackfillCommand({
      args: [
        "--environment", "production",
        "--dry-run",
        "--expected-database", "neondb",
        "--expected-host-fingerprint", productionFingerprint,
      ],
      env: { PRODUCTION_DATABASE_URL: productionUrl },
      identifyDatabase,
      execute,
      writeSafeOutput: vi.fn(),
    })).rejects.toThrow(/confirmation/i);
    expect(execute).not.toHaveBeenCalled();

    await expect(runWebsiteAnalyticsV2BackfillCommand({
      args: [
        "--environment", "production",
        "--dry-run",
        "--confirm-production",
        "--expected-database", "wrong",
        "--expected-host-fingerprint", productionFingerprint,
      ],
      env: { PRODUCTION_DATABASE_URL: productionUrl },
      identifyDatabase,
      execute,
      writeSafeOutput: vi.fn(),
    })).rejects.toThrow(/identity mismatch/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it("uses the isolated Test target and emits aggregate-only output without source cursors", async () => {
    const writeSafeOutput = vi.fn();
    const execute = vi.fn().mockResolvedValue({
      dryRun: true,
      totals: { scanned: 2, created: 0, wouldCreate: 2, unchanged: 0, skipped: 0, failed: 0 },
      sources: [{
        source: "website_orders",
        scanned: 2,
        created: 0,
        wouldCreate: 2,
        unchanged: 0,
        skipped: 0,
        failed: 0,
        cursor: { occurredAt: "2025-01-02T03:04:05.000Z", id: "safe-source-id" },
        complete: false,
        busy: false,
        customerEmail: "must-not-leak@example.test",
      }],
      limitations: ["Historical attribution is limited."],
      privatePayload: { customerName: "Must Not Leak" },
    });
    await runWebsiteAnalyticsV2BackfillCommand({
      args: ["--environment", "test", "--dry-run", "--batch-size", "2"],
      env: {
        TEST_DATABASE_URL: testUrl,
        EXPECTED_PRODUCTION_DATABASE: "neondb",
        EXPECTED_PRODUCTION_HOST_FINGERPRINT: productionFingerprint,
      },
      identifyDatabase: vi.fn().mockResolvedValue({
        database: "rnr_gallery_test",
        hostname: "test-db.example",
        serverVersion: "PostgreSQL 17",
        inRecovery: false,
      }),
      execute,
      writeSafeOutput,
    });
    expect(execute).toHaveBeenCalledWith(testUrl, expect.objectContaining({
      dryRun: true,
      batchSize: 2,
    }));
    expect(writeSafeOutput).toHaveBeenCalledWith({
      environment: "test",
      dryRun: true,
      totals: { scanned: 2, created: 0, wouldCreate: 2, unchanged: 0, skipped: 0, failed: 0 },
      sources: [{
        source: "website_orders",
        scanned: 2,
        created: 0,
        wouldCreate: 2,
        unchanged: 0,
        skipped: 0,
        failed: 0,
        complete: false,
        busy: false,
      }],
      limitations: ["Historical attribution is limited."],
    });
    expect(JSON.stringify(writeSafeOutput.mock.calls)).not.toContain("must-not-leak");
    expect(JSON.stringify(writeSafeOutput.mock.calls)).not.toContain("safe-source-id");
  });

  it("fails before database access for missing or invalid configuration", async () => {
    const identifyDatabase = vi.fn();
    const execute = vi.fn();
    await expect(runWebsiteAnalyticsV2BackfillCommand({
      args: ["--environment", "test", "--dry-run"],
      env: {},
      identifyDatabase,
      execute,
      writeSafeOutput: vi.fn(),
    })).rejects.toThrow(/TEST_DATABASE_URL/i);
    expect(identifyDatabase).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
