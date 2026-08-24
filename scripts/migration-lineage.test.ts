import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pgClient = vi.hoisted(() => ({
  construct: vi.fn(),
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
}));

vi.mock("pg", () => ({
  default: {
    Client: class {
      constructor() {
        pgClient.construct();
      }
      connect = pgClient.connect;
      query = pgClient.query;
      end = pgClient.end;
    },
  },
}));

import {
  assertAppliedMigrationPrefix,
  readAppliedMigrationLineage,
  readLocalMigrationLineage,
  type MigrationLineageEntry,
} from "./migration-lineage";
import { verifyMigrationLineage } from "./migrate-database";

const local: readonly MigrationLineageEntry[] = [
  {
    position: 0,
    hash: "1111111111111111111111111111111111111111111111111111111111111111",
    createdAt: "1000",
    tag: "0000_alpha",
  },
  {
    position: 1,
    hash: "2222222222222222222222222222222222222222222222222222222222222222",
    createdAt: "2000",
    tag: "0001_beta",
  },
  {
    position: 2,
    hash: "3333333333333333333333333333333333333333333333333333333333333333",
    createdAt: "3000",
    tag: "0002_gamma",
  },
];

const temporaryRoots: string[] = [];

type TestJournalEntry = Readonly<{
  version?: unknown;
  idx?: unknown;
  when?: unknown;
  tag?: unknown;
  breakpoints?: unknown;
}>;

function writeLocalLineage(
  entries: readonly TestJournalEntry[],
  sqlByTag: Readonly<Record<string, string>>,
  journalFields: Readonly<{ version?: unknown; dialect?: unknown }> = {},
) {
  const rootDir = mkdtempSync(join(tmpdir(), "migration-lineage-"));
  temporaryRoots.push(rootDir);
  mkdirSync(join(rootDir, "drizzle", "meta"), { recursive: true });
  writeFileSync(join(rootDir, "drizzle", "meta", "_journal.json"), JSON.stringify({
    version: "7",
    dialect: "postgresql",
    ...journalFields,
    entries: entries.map((entry) => ({
      version: "7",
      breakpoints: true,
      ...entry,
    })),
  }));
  for (const [tag, sql] of Object.entries(sqlByTag)) {
    writeFileSync(join(rootDir, "drizzle", `${tag}.sql`), sql);
  }
  return rootDir;
}

afterEach(() => {
  for (const rootDir of temporaryRoots.splice(0)) {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

describe("exact migration prefix", () => {
  it("accepts an empty or exact partial applied prefix", () => {
    expect(() => assertAppliedMigrationPrefix([], local)).not.toThrow();
    expect(() => assertAppliedMigrationPrefix(local.slice(0, 2), local)).not.toThrow();
  });

  it("rejects a changed hash", () => {
    const changedHash = [
      local[0],
      {
        ...local[1],
        hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    ];

    expect(() => assertAppliedMigrationPrefix(changedHash, local))
      .toThrow(/hash mismatch/i);
  });

  it("rejects a changed timestamp", () => {
    const changedTimestamp = [local[0], { ...local[1], createdAt: "2001" }];

    expect(() => assertAppliedMigrationPrefix(changedTimestamp, local))
      .toThrow(/timestamp mismatch/i);
  });

  it("rejects reordered and overlong applied histories", () => {
    const reordered = [local[1], local[0]];
    const tooLong = [
      ...local,
      {
        position: 3,
        hash: "4444444444444444444444444444444444444444444444444444444444444444",
        createdAt: "4000",
      },
    ];

    expect(() => assertAppliedMigrationPrefix(reordered, local)).toThrow(/mismatch/i);
    expect(() => assertAppliedMigrationPrefix(tooLong, local)).toThrow(/longer/i);
  });

  it("rejects uppercase and non-64-character hashes", () => {
    expect(() => assertAppliedMigrationPrefix([
      { ...local[0], hash: "A".repeat(64) },
    ], local)).toThrow(/lowercase.*64-character/i);
    expect(() => assertAppliedMigrationPrefix([
      { ...local[0], hash: "abc123" },
    ], local)).toThrow(/lowercase.*64-character/i);
  });
});

describe("local migration lineage", () => {
  it("hashes SQL bytes and returns journal order", () => {
    const firstSql = "select 1;\n";
    const secondSql = "select 2;\n";
    const rootDir = writeLocalLineage([
      { idx: 0, when: 1000, tag: "0000_alpha" },
      { idx: 1, when: 2000, tag: "0001_beta" },
    ], {
      "0000_alpha": firstSql,
      "0001_beta": secondSql,
    });

    expect(readLocalMigrationLineage(rootDir)).toEqual([
      {
        position: 0,
        hash: createHash("sha256").update(firstSql).digest("hex"),
        createdAt: "1000",
        tag: "0000_alpha",
      },
      {
        position: 1,
        hash: createHash("sha256").update(secondSql).digest("hex"),
        createdAt: "2000",
        tag: "0001_beta",
      },
    ]);
  });

  it("rejects a missing SQL file", () => {
    const rootDir = writeLocalLineage([
      { idx: 0, when: 1000, tag: "0000_missing" },
    ], {});

    expect(() => readLocalMigrationLineage(rootDir)).toThrow(/missing SQL/i);
  });

  it("rejects duplicate indexes and timestamps", () => {
    const duplicateIndexRoot = writeLocalLineage([
      { idx: 0, when: 1000, tag: "0000_alpha" },
      { idx: 0, when: 2000, tag: "0001_beta" },
    ], {
      "0000_alpha": "select 1;\n",
      "0001_beta": "select 2;\n",
    });
    const duplicateTimestampRoot = writeLocalLineage([
      { idx: 0, when: 1000, tag: "0000_alpha" },
      { idx: 1, when: 1000, tag: "0001_beta" },
    ], {
      "0000_alpha": "select 1;\n",
      "0001_beta": "select 2;\n",
    });

    expect(() => readLocalMigrationLineage(duplicateIndexRoot))
      .toThrow(/duplicate journal index/i);
    expect(() => readLocalMigrationLineage(duplicateTimestampRoot))
      .toThrow(/duplicate journal timestamp/i);
  });

  it("rejects ambiguous SQL hash mappings", () => {
    const rootDir = writeLocalLineage([
      { idx: 0, when: 1000, tag: "0000_alpha" },
      { idx: 1, when: 2000, tag: "0001_beta" },
    ], {
      "0000_alpha": "select 1;\n",
      "0001_beta": "select 1;\n",
    });

    expect(() => readLocalMigrationLineage(rootDir))
      .toThrow(/ambiguous.*hash/i);
  });

  it("rejects an invalid or incomplete top-level journal structure", () => {
    const wrongDialectRoot = writeLocalLineage([
      { idx: 0, when: 1000, tag: "0000_alpha" },
    ], {
      "0000_alpha": "select 1;\n",
    }, { dialect: "sqlite" });
    const missingVersionRoot = writeLocalLineage([
      { idx: 0, when: 1000, tag: "0000_alpha" },
    ], {
      "0000_alpha": "select 1;\n",
    }, { version: undefined });

    expect(() => readLocalMigrationLineage(wrongDialectRoot)).toThrow(/dialect/i);
    expect(() => readLocalMigrationLineage(missingVersionRoot)).toThrow(/version/i);
  });

  it("rejects entries with missing required journal fields", () => {
    const requiredFields: readonly (keyof TestJournalEntry)[] = [
      "version",
      "breakpoints",
      "idx",
      "when",
      "tag",
    ];

    for (const field of requiredFields) {
      const rootDir = writeLocalLineage([{
        version: "7",
        breakpoints: true,
        idx: 0,
        when: 1000,
        tag: "0000_alpha",
        [field]: undefined,
      }], {
        "0000_alpha": "select 1;\n",
      });

      expect(() => readLocalMigrationLineage(rootDir), field)
        .toThrow(new RegExp(field, "i"));
    }
  });

  it("rejects invalid journal entry field values", () => {
    const invalidEntries: readonly Readonly<{
      field: keyof TestJournalEntry;
      value: unknown;
    }>[] = [
      { field: "version", value: "6" },
      { field: "breakpoints", value: "true" },
      { field: "idx", value: "0" },
      { field: "when", value: "1000" },
      { field: "tag", value: "../0000_alpha" },
    ];

    for (const { field, value } of invalidEntries) {
      const rootDir = writeLocalLineage([{
        idx: 0,
        when: 1000,
        tag: "0000_alpha",
        [field]: value,
      }], {
        "0000_alpha": "select 1;\n",
      });

      expect(() => readLocalMigrationLineage(rootDir), field)
        .toThrow(new RegExp(field, "i"));
    }
  });
});

describe("applied migration lineage", () => {
  beforeEach(() => {
    pgClient.construct.mockReset();
    pgClient.connect.mockReset().mockResolvedValue(undefined);
    pgClient.query.mockReset().mockImplementation(async (statement: string) => {
      if (/to_regclass/i.test(statement)) {
        return { rows: [{ migrationTable: "drizzle.__drizzle_migrations" }] };
      }
      if (/select id, hash, created_at/i.test(statement)) {
        return {
          rows: [
            {
              id: 1,
              hash: "1111111111111111111111111111111111111111111111111111111111111111",
              createdAt: "1000",
            },
            {
              id: 2,
              hash: "2222222222222222222222222222222222222222222222222222222222222222",
              createdAt: "2000",
            },
          ],
        };
      }
      return { rows: [] };
    });
    pgClient.end.mockReset().mockResolvedValue(undefined);
  });

  it("reads only safe ordered values in a bounded read-only transaction", async () => {
    await expect(readAppliedMigrationLineage("postgresql://user:secret@db.example/app"))
      .resolves.toEqual([
        {
          position: 0,
          hash: "1111111111111111111111111111111111111111111111111111111111111111",
          createdAt: "1000",
        },
        {
          position: 1,
          hash: "2222222222222222222222222222222222222222222222222222222222222222",
          createdAt: "2000",
        },
      ]);

    expect(pgClient.query.mock.calls.map(([statement]) => statement)).toEqual([
      "BEGIN READ ONLY",
      "SET LOCAL statement_timeout = 10000",
      expect.stringMatching(/to_regclass/i),
      expect.stringMatching(/FROM drizzle\.__drizzle_migrations[\s\S]*ORDER BY id/i),
      "ROLLBACK",
    ]);
    expect(pgClient.end).toHaveBeenCalledOnce();
  });

  it("returns an empty lineage when a fresh database has no migration table", async () => {
    pgClient.query.mockImplementation(async (statement: string) => {
      if (/to_regclass/i.test(statement)) {
        return { rows: [{ migrationTable: null }] };
      }
      if (/select id, hash, created_at/i.test(statement)) {
        throw new Error("relation drizzle.__drizzle_migrations does not exist");
      }
      return { rows: [] };
    });

    await expect(readAppliedMigrationLineage("postgresql://db.example/app"))
      .resolves.toEqual([]);
    expect(pgClient.query.mock.calls.map(([statement]) => statement)).toEqual([
      "BEGIN READ ONLY",
      "SET LOCAL statement_timeout = 10000",
      expect.stringMatching(/to_regclass/i),
      "ROLLBACK",
    ]);
  });

  it("allows a SERIAL id gap left by a failed migration retry", async () => {
    pgClient.query.mockImplementation(async (statement: string) => {
      if (/to_regclass/i.test(statement)) {
        return { rows: [{ migrationTable: "drizzle.__drizzle_migrations" }] };
      }
      if (/select id, hash, created_at/i.test(statement)) {
        return {
          rows: [
            {
              id: 1,
              hash: "1111111111111111111111111111111111111111111111111111111111111111",
              createdAt: "1000",
            },
            {
              id: 3,
              hash: "2222222222222222222222222222222222222222222222222222222222222222",
              createdAt: "2000",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const applied = await readAppliedMigrationLineage("postgresql://db.example/app");

    expect(applied).toEqual(local.slice(0, 2).map((entry, position) => ({
      position,
      hash: entry.hash,
      createdAt: entry.createdAt,
    })));
    expect(() => assertAppliedMigrationPrefix(applied, local)).not.toThrow();
  });

  it("allows the default verifier composition on a fresh database", async () => {
    const rootDir = writeLocalLineage([
      { idx: 0, when: 1000, tag: "0000_alpha" },
    ], {
      "0000_alpha": "select 1;\n",
    });
    pgClient.query.mockImplementation(async (statement: string) => {
      if (/to_regclass/i.test(statement)) {
        return { rows: [{ migrationTable: null }] };
      }
      if (/select id, hash, created_at/i.test(statement)) {
        throw new Error("relation drizzle.__drizzle_migrations does not exist");
      }
      return { rows: [] };
    });

    await expect(verifyMigrationLineage("postgresql://db.example/app", rootDir))
      .resolves.toBeUndefined();
  });

  it("does not expose connection values when database reading fails", async () => {
    pgClient.query.mockImplementation(async (statement: string) => {
      if (/select id, hash, created_at/i.test(statement)) {
        throw new Error("failed for postgresql://user:secret@db.example/app");
      }
      return { rows: [] };
    });

    const failure = await readAppliedMigrationLineage(
      "postgresql://user:secret@db.example/app",
    ).catch((error: unknown) => error);

    expect(failure).toEqual(new Error("Applied migration lineage could not be read"));
    expect(String(failure)).not.toContain("user:secret");
    expect(pgClient.end).toHaveBeenCalledOnce();
  });

  it("sanitizes a synchronous pg client construction failure", async () => {
    pgClient.construct.mockImplementationOnce(() => {
      throw new Error("constructor exposed postgresql://user:secret@db.example/app");
    });

    const failure = await readAppliedMigrationLineage(
      "postgresql://user:secret@db.example/app",
    ).catch((error: unknown) => error);

    expect(failure).toEqual(new Error("Applied migration lineage could not be read"));
    expect(String(failure)).not.toContain("user:secret");
    expect(pgClient.connect).not.toHaveBeenCalled();
    expect(pgClient.end).not.toHaveBeenCalled();
  });
});
