import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
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
  indexes: Record<string, unknown>;
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
  it("keeps every snapshot in a single connected non-branching chain", () => {
    const snapshots = readdirSync("drizzle/meta")
      .filter((name) => name.endsWith("_snapshot.json"))
      .map((name) => loadJson<Snapshot>(`drizzle/meta/${name}`));
    expect(new Set(snapshots.map(({ id }) => id)).size).toBe(snapshots.length);
    expect(new Set(snapshots.map(({ prevId }) => prevId)).size).toBe(snapshots.length);
    const visited = new Set<string>();
    let parent = "00000000-0000-0000-0000-000000000000";
    for (let index = 0; index < snapshots.length; index++) {
      const next = snapshots.find(({ prevId }) => prevId === parent);
      expect(next, `missing child after ${parent}`).toBeDefined();
      expect(visited.has(next!.id)).toBe(false);
      visited.add(next!.id);
      parent = next!.id;
    }
    expect(visited.size).toBe(snapshots.length);
  });

  it("extends 0064 only with the photo metadata column defined by 0065 SQL", () => {
    const previous = loadJson<Snapshot>("drizzle/meta/0064_snapshot.json");
    const current = loadJson<Snapshot>("drizzle/meta/0065_snapshot.json");
    expect(current.prevId).toBe(previous.id);
    expect(current.tables["public.order_items"].columns.photo_metadata).toEqual({
      name: "photo_metadata", type: "jsonb", primaryKey: false,
      notNull: true, default: "'[]'::jsonb",
    });
    const normalized = structuredClone(current);
    normalized.id = previous.id;
    normalized.prevId = previous.prevId;
    delete normalized.tables["public.order_items"].columns.photo_metadata;
    // Drizzle regenerated whitespace in this equivalent SQL expression.
    const constraint = "customer_service_conversation_identities_channel_kind_valid";
    for (const snapshot of [normalized, previous]) {
      const check = snapshot.tables["public.customer_service_conversation_identities"].checkConstraints[constraint];
      snapshot.tables["public.customer_service_conversation_identities"].checkConstraints[constraint] = {
        ...check, value: check.value.replace(/\s+/g, " "),
      };
    }
    expect(normalized).toEqual(previous);
  });

  it("extends only the two wall banner product checks in migration 0064", () => {
    const previous = loadJson<Snapshot>("drizzle/meta/0063_snapshot.json");
    const current = loadJson<Snapshot>("drizzle/meta/0064_snapshot.json");
    expect(current.prevId).toBe(previous.id);
    const expected = structuredClone(previous);
    expected.id = current.id;
    expected.prevId = previous.id;
    for (const key of ["gallery_designs_product_slug_valid", "gallery_designs_product_mapping_valid"]) {
      expect(current.tables["public.gallery_designs"].checkConstraints[key].value).toContain("digital-oil-painting-banner");
      expected.tables["public.gallery_designs"].checkConstraints[key] = current.tables["public.gallery_designs"].checkConstraints[key];
    }
    expect(current).toEqual(expected);
    const sql = readFileSync("drizzle/0064_digital_oil_banner_gallery.sql", "utf8");
    expect(sql.match(/ALTER TABLE/g)).toHaveLength(4);
    expect(sql).not.toMatch(/CREATE TABLE|INSERT INTO|UPDATE |DELETE FROM/);
  });

  it("keeps the immutable Production prefix and appends the approved migrations", () => {
    const manifest = loadJson<AppliedMigration[]>(
      "drizzle/production-lineage-2026-08-24.json",
    );
    const journal = loadJson<Journal>("drizzle/meta/_journal.json");

    expect(journal.entries).toHaveLength(66);
    expect(manifest).toHaveLength(54);
    expect(new Set(journal.entries.map((entry) => entry.idx)).size).toBe(66);
    expect(new Set(journal.entries.map((entry) => String(entry.when))).size).toBe(66);

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
    expect(journal.entries[60]).toMatchObject({
      idx: 60,
      when: 1788048058305,
      tag: "0060_website_analytics_v2",
    });
    expect(sha256("drizzle/0060_website_analytics_v2.sql")).toBe(
      "d43b20af5fe5471843c90f5df3ab13134b3e4d13059e39e261e2dffac1aead4e",
    );
    expect(journal.entries[61]).toMatchObject({
      idx: 61,
      when: 1788087828249,
      tag: "0061_website_analytics_internal_traffic",
    });
    expect(sha256("drizzle/0061_website_analytics_internal_traffic.sql")).toBe(
      "4c552b344aa93a05567bffd00044e33df162ba4927e3d952f007549f9d8807dc",
    );
    expect(journal.entries[62]).toMatchObject({
      idx: 62,
      when: 1788256848819,
      tag: "0062_customer_service_conversation_identities",
    });
    expect(sha256("drizzle/0062_customer_service_conversation_identities.sql")).toBe(
      "eb82b078195e3a55329e78687dd83c9b7743743c1c719527d19735eacd3f7c76",
    );
    expect(journal.entries[64]).toMatchObject({
      idx: 64,
      when: 1789009722964,
      tag: "0064_digital_oil_banner_gallery",
    });
    expect(sha256("drizzle/0064_digital_oil_banner_gallery.sql")).toBe(
      "12e8209b66ab9d8864e85cfc1c62b1b48bf7497539a8dfdf39ed35f895546abf",
    );
    expect(journal.entries[65]).toMatchObject({
      idx: 65,
      when: 1789108916477,
      tag: "0065_order_item_photo_metadata",
    });
    expect(sha256("drizzle/0065_order_item_photo_metadata.sql")).toBe(
      "ba129717daf4eb373f88a4785867e17274a2f6e470915887ca5d8b3b263506a8",
    );
  });

  it("adds only staff security tables and the MFA flag after 0062", () => {
    const journal = loadJson<Journal>("drizzle/meta/_journal.json");
    expect(journal.entries[63]).toMatchObject({"idx": 63, "when": 1788991415946, "tag": "0063_staff_account_security"});
    expect(sha256("drizzle/0063_staff_account_security.sql")).toBe("aee51d62469d234085da486755529a5bc50b540711d1368047dcf8d252d9d732");
    const previous = loadJson<Snapshot>("drizzle/meta/0062_snapshot.json");
    const current = loadJson<Snapshot>("drizzle/meta/0063_snapshot.json");
    expect(current.prevId).toBe(previous.id);
    expect(Object.keys(current.tables).filter((name) => !(name in previous.tables)).sort()).toEqual([
      "public.staff_passkey", "public.staff_security", "public.staff_security_policy", "public.staff_session_security", "public.staff_two_factor",
    ]);
    for (const [name, table] of Object.entries(previous.tables)) {
      const actual = structuredClone(current.tables[name]);
      if (name === "public.user") delete actual.columns.two_factor_enabled;
      expect(actual, `${name} has an unrelated schema change`).toEqual(table);
    }
  });

  it("adds only the V2 tables, visitor index, and direct-payment evidence after 0059", () => {
    const previous = loadJson<Snapshot>("drizzle/meta/0059_snapshot.json");
    const current = loadJson<Snapshot>("drizzle/meta/0060_snapshot.json");
    const addedTables = Object.keys(current.tables)
      .filter((table) => !(table in previous.tables))
      .sort();

    expect(current.prevId).toBe(previous.id);
    expect(addedTables).toEqual([
      "public.website_analytics_attribution_snapshots",
      "public.website_analytics_conversions",
      "public.website_analytics_daily_aggregates",
      "public.website_analytics_financial_events",
      "public.website_analytics_reconciliation_state",
    ]);
    expect(
      Object.keys(previous.tables).filter((table) => !(table in current.tables)),
    ).toEqual([]);
    const sessionTable = "public.website_analytics_sessions";
    const paymentAttemptTable = "public.payment_attempts";
    for (const [name, table] of Object.entries(previous.tables)) {
      if (name === sessionTable || name === paymentAttemptTable) continue;
      expect(current.tables[name], `${name} changed in Analytics V2 migration`).toEqual(
        table,
      );
    }
    const normalizedSession = structuredClone(current.tables[sessionTable]);
    expect(normalizedSession.indexes.website_analytics_sessions_visitor_started_id_idx)
      .toMatchObject({
        name: "website_analytics_sessions_visitor_started_id_idx",
        isUnique: false,
        method: "btree",
        columns: [
          { expression: "visitor_digest", isExpression: false },
          { expression: "started_at", isExpression: false },
          { expression: "id", isExpression: false },
        ],
      });
    delete normalizedSession.indexes.website_analytics_sessions_visitor_started_id_idx;
    expect(normalizedSession).toEqual(previous.tables[sessionTable]);
    const normalizedPaymentAttempts = structuredClone(current.tables[paymentAttemptTable]);
    for (const column of [
      "website_analytics_paid_at",
      "website_analytics_refunded_at",
    ]) {
      expect(normalizedPaymentAttempts.columns[column]).toEqual({
        name: column,
        type: "timestamp with time zone",
        primaryKey: false,
        notNull: false,
      });
      delete normalizedPaymentAttempts.columns[column];
    }
    expect(normalizedPaymentAttempts).toEqual(previous.tables[paymentAttemptTable]);
    expect({
      version: current.version,
      dialect: current.dialect,
      enums: current.enums,
      schemas: current.schemas,
      sequences: current.sequences,
      roles: current.roles,
      policies: current.policies,
      views: current.views,
      _meta: current._meta,
    }).toEqual({
      version: previous.version,
      dialect: previous.dialect,
      enums: previous.enums,
      schemas: previous.schemas,
      sequences: previous.sequences,
      roles: previous.roles,
      policies: previous.policies,
      views: previous.views,
      _meta: previous._meta,
    });
  });

  it("adds only the approved internal-traffic fields, indexes, and constraint after 0060", () => {
    const previous = loadJson<Snapshot>("drizzle/meta/0060_snapshot.json");
    const current = loadJson<Snapshot>("drizzle/meta/0061_snapshot.json");
    const normalizedPrevious = structuredClone(previous);
    const normalizedCurrent = structuredClone(current);
    const sessions = "public.website_analytics_sessions";
    const conversions = "public.website_analytics_conversions";
    const daily = "public.website_analytics_daily_aggregates";

    expect(current.prevId).toBe(previous.id);
    expect(Object.keys(current.tables)).toEqual(Object.keys(previous.tables));
    for (const table of [sessions, conversions]) {
      expect(current.tables[table].columns.is_internal).toMatchObject({
        name: "is_internal",
        type: "boolean",
        primaryKey: false,
        notNull: true,
        default: false,
      });
      delete normalizedCurrent.tables[table].columns.is_internal;
    }
    for (const [table, index] of [
      [sessions, "website_analytics_sessions_internal_local_date_idx"],
      [conversions, "website_analytics_conversions_internal_local_date_idx"],
    ] as const) {
      expect(current.tables[table].indexes[index]).toBeDefined();
      delete normalizedCurrent.tables[table].indexes[index];
    }
    for (const column of [
      "internal_visitors",
      "internal_sessions",
      "internal_page_views",
      "internal_inquiries",
      "internal_orders",
      "internal_paid_orders",
      "internal_ordered_revenue_cents",
      "internal_collected_revenue_cents",
      "internal_refunded_revenue_cents",
      "internal_net_collected_revenue_cents",
    ]) {
      expect(current.tables[daily].columns[column]).toBeDefined();
      delete normalizedCurrent.tables[daily].columns[column];
    }
    expect(current.tables[daily].checkConstraints.website_analytics_daily_internal_metrics_valid)
      .toBeDefined();
    delete normalizedCurrent.tables[daily]
      .checkConstraints.website_analytics_daily_internal_metrics_valid;
    normalizedCurrent.id = normalizedPrevious.id;
    normalizedCurrent.prevId = normalizedPrevious.prevId;
    expect(normalizedCurrent).toEqual(normalizedPrevious);
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
