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
type SnapshotCheck = Readonly<{ name: string; value: string }>;
type SnapshotTable = Readonly<{
  columns: Record<string, unknown>;
  checkConstraints: Record<string, SnapshotCheck>;
  [key: string]: unknown;
}>;
type Snapshot = {
  id: string;
  prevId: string;
  version: string;
  dialect: string;
  tables: Record<string, SnapshotTable>;
  enums: Record<string, unknown>;
  schemas: Record<string, unknown>;
  sequences: Record<string, unknown>;
  roles: Record<string, unknown>;
  policies: Record<string, unknown>;
  views: Record<string, unknown>;
  _meta: unknown;
  [key: string]: unknown;
};

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as T;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(resolve(path))).digest("hex");
}

describe("migration lineage artifacts", () => {
  it("keeps the immutable Production prefix and appends the approved migrations", () => {
    const manifest = loadJson<AppliedMigration[]>(
      "drizzle/production-lineage-2026-08-24.json",
    );
    const journal = loadJson<Journal>("drizzle/meta/_journal.json");

    expect(journal.entries).toHaveLength(60);
    expect(manifest).toHaveLength(54);
    expect(new Set(journal.entries.map((entry) => entry.idx)).size).toBe(60);
    expect(new Set(journal.entries.map((entry) => String(entry.when))).size).toBe(60);

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
    expect(journal.entries[55]).toMatchObject({
      idx: 55,
      when: 1787609642192,
      tag: "20260824221402_ai_human_review_notifications",
    });
    expect(
      sha256("drizzle/20260824221402_ai_human_review_notifications.sql"),
    ).toBe("28052f2c7f1b075892c10f66589cbde1859386c6b9dd7ac2f79642aa282d9fc1");
    expect(journal.entries[56]).toMatchObject({
      idx: 56,
      when: 1787614309711,
      tag: "20260824233149_internal_notification_provider_send_start",
    });
    expect(
      sha256("drizzle/20260824233149_internal_notification_provider_send_start.sql"),
    ).toBe("142b83f2980055ba5c0484b835e830817ea11cb68cf634b5af5a7fcdca16c0bb");
    expect(journal.entries[57]).toMatchObject({
      idx: 57,
      when: 1787892120059,
      tag: "0057_late_swordsman",
    });
    expect(sha256("drizzle/0057_late_swordsman.sql")).toBe(
      "b73b9fba0f7d3332dec71eef59f5606aa2907447b75921e8735b0ae930b74e34",
    );
    expect(journal.entries[58]).toMatchObject({
      idx: 58,
      when: 1787989656813,
      tag: "0058_website_analytics_v1",
    });
    expect(sha256("drizzle/0058_website_analytics_v1.sql")).toBe(
      "341b697c0397feb588e62436f3234d25bd8ec4043df0bba0e80bad3f52320499",
    );
    expect(journal.entries[59]).toMatchObject({
      idx: 59,
      when: 1787996906191,
      tag: "0059_customer_review_sources",
    });
    expect(sha256("drizzle/0059_customer_review_sources.sql")).toBe(
      "1b3631508005319ab310eba0f22de44d429abc18f964890b9e55e9de6810bd5a",
    );
  });

  it("changes only the customer review source constraint", () => {
    const previous = loadJson<Snapshot>("drizzle/meta/0058_snapshot.json");
    const current = loadJson<Snapshot>("drizzle/meta/0059_snapshot.json");
    const normalizedPrevious = structuredClone(previous);
    const normalizedCurrent = structuredClone(current);
    const table = "public.customer_reviews";
    const constraint = "customer_reviews_source_platform_valid";

    expect(current.prevId).toBe(previous.id);
    expect(current.tables[table]?.checkConstraints[constraint]).toEqual({
      name: constraint,
      value: `"customer_reviews"."source_platform" in ('FACEBOOK', 'GOOGLE')`,
    });
    normalizedCurrent.tables[table].checkConstraints[constraint] =
      previous.tables[table].checkConstraints[constraint];
    normalizedCurrent.id = normalizedPrevious.id;
    normalizedCurrent.prevId = normalizedPrevious.prevId;
    expect(normalizedCurrent).toEqual(normalizedPrevious);
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

  it("changes only the three approved notification check constraints", () => {
    const previous = loadJson<Snapshot>("drizzle/meta/0056_snapshot.json");
    const current = loadJson<Snapshot>(
      "drizzle/meta/20260824221402_snapshot.json",
    );
    const normalizedPrevious = structuredClone(previous);
    const normalizedCurrent = structuredClone(current);
    const changes = [
      {
        table: "public.internal_notification_outbox",
        constraint: "internal_notification_outbox_topic_valid",
        value:
          `"internal_notification_outbox"."topic" in ('manual_order_created', 'web_order_paid', 'payment_request_paid', 'proof_approved', 'proof_changes_requested', 'website_ai_human_review_required')`,
      },
      {
        table: "public.internal_notification_outbox",
        constraint: "internal_notification_outbox_resource_type_valid",
        value:
          `"internal_notification_outbox"."resource_type" in ('production_job', 'order', 'payment_request', 'proof_review', 'customer_service_review')`,
      },
      {
        table: "public.internal_notification_subscriptions",
        constraint: "internal_notification_subscriptions_topic_valid",
        value:
          `"internal_notification_subscriptions"."topic" in ('manual_order_created', 'web_order_paid', 'payment_request_paid', 'proof_approved', 'proof_changes_requested', 'website_ai_human_review_required')`,
      },
    ] as const;

    expect(current.prevId).toBe(previous.id);
    normalizedCurrent.id = normalizedPrevious.id;
    normalizedCurrent.prevId = normalizedPrevious.prevId;
    for (const change of changes) {
      expect(
        current.tables[change.table]?.checkConstraints[change.constraint],
      ).toEqual({ name: change.constraint, value: change.value });
      normalizedCurrent.tables[change.table].checkConstraints[
        change.constraint
      ] = previous.tables[change.table].checkConstraints[change.constraint];
    }
    expect(normalizedCurrent).toEqual(normalizedPrevious);
  });

  it("adds only the provider-send linearization marker to the internal outbox", () => {
    const previous = loadJson<Snapshot>(
      "drizzle/meta/20260824221402_snapshot.json",
    );
    const current = loadJson<Snapshot>(
      "drizzle/meta/20260824233149_snapshot.json",
    );
    const normalizedPrevious = structuredClone(previous);
    const normalizedCurrent = structuredClone(current);
    const table = "public.internal_notification_outbox";

    expect(current.prevId).toBe(previous.id);
    expect(current.tables[table]?.columns).toMatchObject({
      provider_send_started_at: {
        name: "provider_send_started_at",
        type: "timestamp with time zone",
        primaryKey: false,
        notNull: false,
      },
    });
    expect(
      sha256("drizzle/meta/20260824233149_snapshot.json"),
    ).toBe("5e41c6e13475673a5814c521e6d7410a0189877dec40923a6338d63f4eac5752");
    delete normalizedCurrent.tables[table].columns.provider_send_started_at;
    normalizedCurrent.id = normalizedPrevious.id;
    normalizedCurrent.prevId = normalizedPrevious.prevId;
    expect(normalizedCurrent).toEqual(normalizedPrevious);
  });
});
