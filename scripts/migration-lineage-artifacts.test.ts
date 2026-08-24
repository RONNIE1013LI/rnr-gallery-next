import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type AppliedMigration = Readonly<{
  id: number;
  hash: string;
  createdAt: string;
}>;

type JournalEntry = Readonly<{
  idx: number;
  when: number;
  tag: string;
}>;

type Journal = Readonly<{ entries: JournalEntry[] }>;
type Snapshot = Readonly<{ tables: Record<string, unknown> }>;

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as T;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(resolve(path))).digest("hex");
}

describe("migration lineage artifacts", () => {
  it("keeps the immutable Production prefix before the canonical notification migration", () => {
    const manifest = loadJson<AppliedMigration[]>(
      "drizzle/production-lineage-2026-08-24.json",
    );
    const journal = loadJson<Journal>("drizzle/meta/_journal.json");

    expect(journal.entries).toHaveLength(55);
    expect(manifest).toHaveLength(54);
    expect(new Set(journal.entries.map((entry) => entry.idx)).size).toBe(55);
    expect(new Set(journal.entries.map((entry) => String(entry.when))).size).toBe(55);

    for (const [index, applied] of manifest.entries()) {
      const entry = journal.entries[index];
      expect(entry.idx).toBe(index);
      expect(String(entry.when)).toBe(applied.createdAt);
      expect(sha256(`drizzle/${entry.tag}.sql`)).toBe(applied.hash);
    }

    expect(journal.entries[54]).toMatchObject({
      idx: 54,
      when: 1787525686969,
      tag: "0056_internal_notification_center",
    });
  });

  it("keeps the latest applied snapshot at the 71-table pre-notification schema", () => {
    const snapshot = loadJson<Snapshot>("drizzle/meta/0055_snapshot.json");
    const tables = Object.keys(snapshot.tables);

    expect(tables).toHaveLength(71);
    expect(tables.filter((table) => table.startsWith("public.internal_notification_")))
      .toEqual([]);
  });

  it("adds only the three notification tables after the applied snapshot", () => {
    const previous = loadJson<Snapshot>("drizzle/meta/0055_snapshot.json");
    const current = loadJson<Snapshot>("drizzle/meta/0056_snapshot.json");
    const addedTables = Object.keys(current.tables)
      .filter((table) => !(table in previous.tables))
      .sort();

    expect(addedTables).toEqual([
      "public.internal_notification_outbox",
      "public.internal_notification_recipients",
      "public.internal_notification_subscriptions",
    ]);
    expect(
      Object.keys(previous.tables).filter((table) => !(table in current.tables)),
    ).toEqual([]);

    for (const [name, table] of Object.entries(previous.tables)) {
      expect(current.tables[name], `${name} changed in notification migration`).toEqual(
        table,
      );
    }
  });
});
