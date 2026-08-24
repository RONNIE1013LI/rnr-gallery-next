import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

export type MigrationLineageEntry = Readonly<{
  position: number;
  hash: string;
  createdAt: string;
  tag?: string;
}>;

type JournalEntry = Readonly<{
  idx: unknown;
  when: unknown;
  tag: unknown;
}>;

type AppliedMigrationRow = Readonly<{
  id: unknown;
  hash: unknown;
  createdAt: unknown;
}>;

function decimalString(value: unknown, label: string): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  throw new Error(`${label} must be a non-negative decimal integer`);
}

function lowercaseSha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase 64-character SHA-256 hash`);
  }
  return value;
}

function migrationPosition(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function validateLineageEntry(
  entry: MigrationLineageEntry,
  expectedPosition: number,
  lineage: string,
) {
  const position = migrationPosition(entry.position, `${lineage} migration position`);
  if (position !== expectedPosition) {
    throw new Error(`Migration position mismatch at position ${expectedPosition}`);
  }
  lowercaseSha256(entry.hash, `${lineage} migration hash`);
  decimalString(entry.createdAt, `${lineage} migration timestamp`);
}

export function assertAppliedMigrationPrefix(
  applied: readonly MigrationLineageEntry[],
  local: readonly MigrationLineageEntry[],
): void {
  if (applied.length > local.length) {
    throw new Error("Applied migration history is longer than the local journal");
  }

  for (const [position, entry] of local.entries()) {
    validateLineageEntry(entry, position, "Local");
  }

  for (const [position, entry] of applied.entries()) {
    validateLineageEntry(entry, position, "Applied");
    const expected = local[position];
    if (entry.hash !== expected.hash) {
      throw new Error(`Migration hash mismatch at position ${position}`);
    }
    if (entry.createdAt !== expected.createdAt) {
      throw new Error(`Migration timestamp mismatch at position ${position}`);
    }
  }
}

export function readLocalMigrationLineage(
  rootDir: string,
): readonly MigrationLineageEntry[] {
  const journalPath = resolve(rootDir, "drizzle", "meta", "_journal.json");
  let journal: unknown;
  try {
    journal = JSON.parse(readFileSync(journalPath, "utf8")) as unknown;
  } catch {
    throw new Error("Migration journal could not be read");
  }

  if (
    typeof journal !== "object" ||
    journal === null ||
    !("entries" in journal) ||
    !Array.isArray(journal.entries)
  ) {
    throw new Error("Migration journal structure is invalid");
  }

  const entries = journal.entries as JournalEntry[];
  const indexes = new Set<number>();
  const timestamps = new Set<string>();
  const hashes = new Set<string>();
  const lineage: MigrationLineageEntry[] = [];

  for (const [position, entry] of entries.entries()) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`Migration journal entry ${position} is invalid`);
    }
    const index = migrationPosition(entry.idx, "Migration journal index");
    if (indexes.has(index)) throw new Error(`Duplicate journal index at position ${position}`);
    indexes.add(index);
    if (index !== position) {
      throw new Error(`Migration journal index mismatch at position ${position}`);
    }

    const createdAt = decimalString(entry.when, "Migration journal timestamp");
    if (timestamps.has(createdAt)) {
      throw new Error(`Duplicate journal timestamp at position ${position}`);
    }
    timestamps.add(createdAt);

    if (typeof entry.tag !== "string" || !/^[A-Za-z0-9_-]+$/.test(entry.tag)) {
      throw new Error(`Migration journal tag at position ${position} is invalid`);
    }
    const sqlPath = resolve(rootDir, "drizzle", `${entry.tag}.sql`);
    if (!existsSync(sqlPath)) {
      throw new Error(`Missing SQL for migration at position ${position}`);
    }
    const hash = createHash("sha256").update(readFileSync(sqlPath)).digest("hex");
    if (hashes.has(hash)) {
      throw new Error(`Ambiguous migration hash mapping at position ${position}`);
    }
    hashes.add(hash);

    lineage.push(Object.freeze({
      position,
      hash,
      createdAt,
      tag: entry.tag,
    }));
  }

  return Object.freeze(lineage);
}

export async function readAppliedMigrationLineage(
  connectionString: string,
): Promise<readonly MigrationLineageEntry[]> {
  const client = new pg.Client({ connectionString });
  let transactionOpen = false;
  let rows: readonly AppliedMigrationRow[] = [];
  let failure: Error | undefined;
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = 10000");
    const result = await client.query<AppliedMigrationRow>(
      `SELECT id, hash, created_at AS "createdAt"
       FROM drizzle.__drizzle_migrations
       ORDER BY id`,
    );
    rows = result.rows;
    await client.query("ROLLBACK");
    transactionOpen = false;
  } catch {
    failure = new Error("Applied migration lineage could not be read");
  } finally {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original failure while still closing the client.
      }
    }
    try {
      await client.end();
    } catch {
      failure ??= new Error("Applied migration lineage could not be read");
    }
  }

  if (failure) throw failure;
  const lineage = rows.map((row, index) => {
    const id = migrationPosition(row.id, "Applied migration id");
    const position = id - 1;
    if (position !== index) {
      throw new Error(`Migration position mismatch at position ${index}`);
    }
    return Object.freeze({
      position,
      hash: lowercaseSha256(row.hash, "Applied migration hash"),
      createdAt: decimalString(row.createdAt, "Applied migration timestamp"),
    });
  });
  return Object.freeze(lineage);
}
