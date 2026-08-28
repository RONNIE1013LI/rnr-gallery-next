import { describe, expect, it, vi } from "vitest";
import { databaseHostFingerprint } from "./migration-safety";
import type { MigrationLineageEntry } from "./migration-lineage";
import type { SchemaCatalog } from "./schema-catalog";
import {
  parseLineageCheckArguments,
  runLineageCheck,
} from "./verify-migration-lineage";

const productionUrl = "postgresql://app:production-password@prod.example/neondb";
const testUrl = "postgresql://tester:test-password@127.0.0.1:55450/rnr_migration_lineage_test";
const expectedHostFingerprint = databaseHostFingerprint("prod.example");

const localLineage: readonly MigrationLineageEntry[] = [
  { position: 0, hash: "1".repeat(64), createdAt: "1000", tag: "0000_alpha" },
  { position: 1, hash: "2".repeat(64), createdAt: "2000", tag: "0001_beta" },
];

const catalog: SchemaCatalog = {
  tables: [{
    schema: "public",
    name: "orders",
    columns: [
      { name: "id", dataType: "uuid", nullable: false, default: "gen_random_uuid()" },
      { name: "status", dataType: "text", nullable: false, default: "'new'::text" },
    ],
  }],
  indexes: [{
    schema: "public",
    table: "orders",
    name: "orders_pkey",
    definition: "CREATE UNIQUE INDEX orders_pkey ON public.orders USING btree (id)",
  }],
  constraints: [{
    schema: "public",
    table: "orders",
    name: "orders_pkey",
    type: "primaryKey",
    definition: "PRIMARY KEY (id)",
  }],
  enums: [{ schema: "public", name: "order_state", values: ["new", "paid"] }],
  sequences: [{
    schema: "public",
    name: "order_number_seq",
    dataType: "bigint",
    start: "1000",
    minimum: "1",
    maximum: "9223372036854775807",
    increment: "1",
    cache: "1",
    cycle: false,
    owner: "public.orders.order_number",
  }],
};

function productionArguments() {
  return {
    environment: "production" as const,
    confirmProduction: true,
    expectedDatabase: "neondb",
    expectedHostFingerprint,
    compareTestCatalog: true,
  };
}

function dependencies(overrides: Partial<Parameters<typeof runLineageCheck>[0]> = {}) {
  return {
    args: productionArguments(),
    env: {
      PRODUCTION_DATABASE_URL: productionUrl,
      TEST_DATABASE_URL: testUrl,
      EXPECTED_PRODUCTION_DATABASE: "neondb",
      EXPECTED_PRODUCTION_HOST_FINGERPRINT: expectedHostFingerprint,
    },
    rootDir: "/repo",
    identifyDatabase: vi.fn(async (_url: string, hostname: string) => ({
      database: hostname === "prod.example" ? "neondb" : "rnr_migration_lineage_test",
      hostname,
      serverVersion: "PostgreSQL 17",
      inRecovery: false,
    })),
    readLocalLineage: vi.fn(() => localLineage),
    readAppliedLineage: vi.fn(async () => localLineage.map((entry) => ({
      position: entry.position,
      hash: entry.hash,
      createdAt: entry.createdAt,
    }))),
    readCatalog: vi.fn(async () => catalog),
    ...overrides,
  };
}

describe("lineage check arguments", () => {
  it("requires explicit environment and expected identity arguments", () => {
    expect(parseLineageCheckArguments([
      "--environment", "production",
      "--confirm-production",
      "--expected-database", "neondb",
      "--expected-host-fingerprint", "a".repeat(64),
      "--compare-test-catalog",
    ])).toEqual({
      environment: "production",
      confirmProduction: true,
      expectedDatabase: "neondb",
      expectedHostFingerprint: "a".repeat(64),
      compareTestCatalog: true,
    });

    expect(() => parseLineageCheckArguments([
      "--environment", "production",
      "--confirm-production",
      "--expected-host-fingerprint", "a".repeat(64),
    ])).toThrow(/expected database/i);
    expect(() => parseLineageCheckArguments([
      "--environment", "production",
      "--confirm-production",
      "--expected-database", "neondb",
    ])).toThrow(/expected host fingerprint/i);
  });

  it("never reflects an unknown or positional argument", () => {
    for (const argument of [
      productionUrl,
      `--database-url=${productionUrl}`,
    ]) {
      let message = "";
      try {
        parseLineageCheckArguments([argument]);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toBe("Unknown migration argument");
      expect(message).not.toContain(productionUrl);
      expect(message).not.toContain("production-password");
    }
  });
});

describe("read-only migration lineage verifier", () => {
  it("accepts equal exact prefixes and catalogs with a credential-free summary", async () => {
    const input = dependencies();
    const summary = await runLineageCheck(input);

    expect(summary).toEqual({
      environment: "production",
      production: {
        database: "neondb",
        appliedCount: 2,
        matchingPrefixCount: 2,
        catalogObjectCounts: {
          tables: 1,
          columns: 2,
          indexes: 1,
          constraints: 1,
          enums: 1,
          sequences: 1,
        },
      },
      test: {
        database: "rnr_migration_lineage_test",
        appliedCount: 2,
        matchingPrefixCount: 2,
        catalogObjectCounts: {
          tables: 1,
          columns: 2,
          indexes: 1,
          constraints: 1,
          enums: 1,
          sequences: 1,
        },
      },
      differences: [],
    });
    const output = JSON.stringify(summary);
    expect(output).not.toContain(productionUrl);
    expect(output).not.toContain(testUrl);
    expect(output).not.toContain("production-password");
    expect(output).not.toContain("test-password");
  });

  it("rejects a lineage difference before reading either catalog", async () => {
    const readCatalog = vi.fn(async () => catalog);
    const input = dependencies({
      readAppliedLineage: vi.fn(async (url: string) => (
        url === productionUrl
          ? [localLineage[0], { ...localLineage[1], hash: "f".repeat(64) }]
          : localLineage
      )),
      readCatalog,
    });

    await expect(runLineageCheck(input)).rejects.toThrow(/hash mismatch/i);
    expect(readCatalog).not.toHaveBeenCalled();
  });

  it("rejects catalog differences with exact object paths", async () => {
    const changedTestCatalog: SchemaCatalog = {
      ...catalog,
      tables: [{
        ...catalog.tables[0],
        columns: [
          { ...catalog.tables[0].columns[0], dataType: "text" },
          catalog.tables[0].columns[1],
        ],
      }],
    };
    const input = dependencies({
      readCatalog: vi.fn(async (url: string) => (
        url === productionUrl ? catalog : changedTestCatalog
      )),
    });

    await expect(runLineageCheck(input)).rejects.toThrow(
      /tables\.public\.orders\.columns\.id\.dataType/,
    );
  });

  it("redacts supplied URLs and passwords from dependency failures", async () => {
    const input = dependencies({
      identifyDatabase: vi.fn(async () => {
        throw new Error(`connection failed for ${productionUrl}`);
      }),
    });

    const error = await runLineageCheck(input).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Production database identity could not be read");
    expect((error as Error).message).not.toContain(productionUrl);
    expect((error as Error).message).not.toContain("production-password");
  });

  it("requires both runtime URLs before any database call", async () => {
    const identifyDatabase = vi.fn();
    const input = dependencies({
      env: { PRODUCTION_DATABASE_URL: productionUrl },
      identifyDatabase,
    });

    await expect(runLineageCheck(input)).rejects.toThrow(/TEST_DATABASE_URL is required/i);
    expect(identifyDatabase).not.toHaveBeenCalled();
  });
});
