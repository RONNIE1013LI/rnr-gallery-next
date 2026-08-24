import { beforeEach, describe, expect, it, vi } from "vitest";

const pgClient = vi.hoisted(() => ({
  construct: vi.fn(),
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
}));

vi.mock("pg", () => ({
  default: {
    Client: class {
      constructor(config: unknown) {
        pgClient.construct(config);
      }
      connect = pgClient.connect;
      query = pgClient.query;
      end = pgClient.end;
    },
  },
}));

import {
  compareSchemaCatalogs,
  normalizeSchemaCatalog,
  readSchemaCatalog,
  type SchemaCatalog,
} from "./schema-catalog";

const emptyCatalog: SchemaCatalog = {
  tables: [],
  indexes: [],
  constraints: [],
  enums: [],
  sequences: [],
};

describe("schema catalog normalization", () => {
  it("sorts every object and nested column deterministically", () => {
    const unordered: SchemaCatalog = {
      tables: [
        {
          schema: "public",
          name: "zebra",
          columns: [
            { name: "zulu", dataType: "text", nullable: true, default: null },
            { name: "alpha", dataType: "integer", nullable: false, default: "0" },
          ],
        },
        { schema: "audit", name: "events", columns: [] },
      ],
      indexes: [
        {
          schema: "public",
          table: "zebra",
          name: "zebra_zulu_idx",
          definition: "CREATE INDEX zebra_zulu_idx ON public.zebra USING btree (zulu)",
        },
        {
          schema: "audit",
          table: "events",
          name: "events_pkey",
          definition: "CREATE UNIQUE INDEX events_pkey ON audit.events USING btree (id)",
        },
      ],
      constraints: [
        {
          schema: "public",
          table: "zebra",
          name: "zebra_zulu_check",
          type: "check",
          definition: "CHECK (zulu <> ''::text)",
        },
        {
          schema: "audit",
          table: "events",
          name: "events_pkey",
          type: "primaryKey",
          definition: "PRIMARY KEY (id)",
        },
      ],
      enums: [
        { schema: "public", name: "zebra_state", values: ["draft", "sent"] },
        { schema: "audit", name: "event_kind", values: ["created"] },
      ],
      sequences: [
        {
          schema: "public",
          name: "zebra_number_seq",
          dataType: "bigint",
          start: "100",
          minimum: "1",
          maximum: "9223372036854775807",
          increment: "1",
          cache: "1",
          cycle: false,
          owner: "public.zebra.number",
        },
        {
          schema: "audit",
          name: "event_id_seq",
          dataType: "bigint",
          start: "1",
          minimum: "1",
          maximum: "9223372036854775807",
          increment: "1",
          cache: "1",
          cycle: false,
          owner: "audit.events.id",
        },
      ],
    };

    expect(normalizeSchemaCatalog(unordered)).toEqual({
      tables: [
        { schema: "audit", name: "events", columns: [] },
        {
          schema: "public",
          name: "zebra",
          columns: [
            { name: "alpha", dataType: "integer", nullable: false, default: "0" },
            { name: "zulu", dataType: "text", nullable: true, default: null },
          ],
        },
      ],
      indexes: [unordered.indexes[1], unordered.indexes[0]],
      constraints: [unordered.constraints[1], unordered.constraints[0]],
      enums: [unordered.enums[1], unordered.enums[0]],
      sequences: [unordered.sequences[1], unordered.sequences[0]],
    });
  });
});

describe("schema catalog comparison", () => {
  it("reports added and removed tables and columns at exact object paths", () => {
    const expected: SchemaCatalog = {
      ...emptyCatalog,
      tables: [
        {
          schema: "public",
          name: "orders",
          columns: [
            { name: "id", dataType: "uuid", nullable: false, default: "gen_random_uuid()" },
            { name: "legacy", dataType: "text", nullable: true, default: null },
          ],
        },
        { schema: "public", name: "removed_table", columns: [] },
      ],
    };
    const actual: SchemaCatalog = {
      ...emptyCatalog,
      tables: [
        {
          schema: "public",
          name: "orders",
          columns: [
            { name: "id", dataType: "uuid", nullable: false, default: "gen_random_uuid()" },
            { name: "added", dataType: "text", nullable: true, default: null },
          ],
        },
        { schema: "public", name: "added_table", columns: [] },
      ],
    };

    expect(compareSchemaCatalogs(expected, actual)).toEqual([
      { kind: "added", path: "tables.public.added_table" },
      { kind: "removed", path: "tables.public.removed_table" },
      { kind: "added", path: "tables.public.orders.columns.added" },
      { kind: "removed", path: "tables.public.orders.columns.legacy" },
    ]);
  });

  it("reports column type, nullability, and default changes at scalar paths", () => {
    const expected: SchemaCatalog = {
      ...emptyCatalog,
      tables: [{
        schema: "public",
        name: "orders",
        columns: [{ name: "total", dataType: "numeric(10,2)", nullable: false, default: "0.00" }],
      }],
    };
    const actual: SchemaCatalog = {
      ...emptyCatalog,
      tables: [{
        schema: "public",
        name: "orders",
        columns: [{ name: "total", dataType: "numeric(12,2)", nullable: true, default: null }],
      }],
    };

    expect(compareSchemaCatalogs(expected, actual)).toEqual([
      {
        kind: "changed",
        path: "tables.public.orders.columns.total.dataType",
        expected: "numeric(10,2)",
        actual: "numeric(12,2)",
      },
      {
        kind: "changed",
        path: "tables.public.orders.columns.total.default",
        expected: "0.00",
        actual: null,
      },
      {
        kind: "changed",
        path: "tables.public.orders.columns.total.nullable",
        expected: false,
        actual: true,
      },
    ]);
  });

  it("detects added, removed, and changed indexes, constraints, enums, and sequences", () => {
    const expected: SchemaCatalog = {
      ...emptyCatalog,
      indexes: [
        { schema: "public", table: "orders", name: "changed_idx", definition: "CREATE INDEX changed_idx ON public.orders USING btree (created_at)" },
        { schema: "public", table: "orders", name: "removed_idx", definition: "CREATE INDEX removed_idx ON public.orders USING btree (status)" },
      ],
      constraints: [
        { schema: "public", table: "orders", name: "changed_check", type: "check", definition: "CHECK (total >= 0)" },
        { schema: "public", table: "orders", name: "removed_check", type: "check", definition: "CHECK (status <> '')" },
      ],
      enums: [
        { schema: "public", name: "changed_state", values: ["draft", "sent"] },
        { schema: "public", name: "removed_state", values: ["old"] },
      ],
      sequences: [
        { schema: "public", name: "changed_seq", dataType: "bigint", start: "1", minimum: "1", maximum: "999", increment: "1", cache: "1", cycle: false, owner: "public.orders.number" },
        { schema: "public", name: "removed_seq", dataType: "bigint", start: "1", minimum: "1", maximum: "999", increment: "1", cache: "1", cycle: false, owner: null },
      ],
    };
    const actual: SchemaCatalog = {
      ...emptyCatalog,
      indexes: [
        { schema: "public", table: "orders", name: "added_idx", definition: "CREATE INDEX added_idx ON public.orders USING btree (id)" },
        { schema: "public", table: "orders", name: "changed_idx", definition: "CREATE UNIQUE INDEX changed_idx ON public.orders USING btree (created_at)" },
      ],
      constraints: [
        { schema: "public", table: "orders", name: "added_check", type: "check", definition: "CHECK (id IS NOT NULL)" },
        { schema: "public", table: "orders", name: "changed_check", type: "check", definition: "CHECK (total > 0)" },
      ],
      enums: [
        { schema: "public", name: "added_state", values: ["new"] },
        { schema: "public", name: "changed_state", values: ["draft", "sent", "failed"] },
      ],
      sequences: [
        { schema: "public", name: "added_seq", dataType: "bigint", start: "1", minimum: "1", maximum: "999", increment: "1", cache: "1", cycle: false, owner: null },
        { schema: "public", name: "changed_seq", dataType: "bigint", start: "1", minimum: "1", maximum: "999", increment: "1", cache: "20", cycle: false, owner: "public.orders.number" },
      ],
    };

    expect(compareSchemaCatalogs(expected, actual)).toEqual([
      { kind: "added", path: "indexes.public.orders.added_idx" },
      {
        kind: "changed",
        path: "indexes.public.orders.changed_idx.definition",
        expected: expected.indexes[0].definition,
        actual: actual.indexes[1].definition,
      },
      { kind: "removed", path: "indexes.public.orders.removed_idx" },
      { kind: "added", path: "constraints.public.orders.added_check" },
      {
        kind: "changed",
        path: "constraints.public.orders.changed_check.definition",
        expected: "CHECK (total >= 0)",
        actual: "CHECK (total > 0)",
      },
      { kind: "removed", path: "constraints.public.orders.removed_check" },
      { kind: "added", path: "enums.public.added_state" },
      {
        kind: "changed",
        path: "enums.public.changed_state.values",
        expected: ["draft", "sent"],
        actual: ["draft", "sent", "failed"],
      },
      { kind: "removed", path: "enums.public.removed_state" },
      { kind: "added", path: "sequences.public.added_seq" },
      {
        kind: "changed",
        path: "sequences.public.changed_seq.cache",
        expected: "1",
        actual: "20",
      },
      { kind: "removed", path: "sequences.public.removed_seq" },
    ]);
  });
});

describe("read-only schema catalog", () => {
  beforeEach(() => {
    pgClient.construct.mockReset();
    pgClient.connect.mockReset().mockResolvedValue(undefined);
    pgClient.query.mockReset()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            schemaName: "public",
            tableName: "orders",
            columnName: "status",
            dataType: "text",
            nullable: true,
            defaultValue: null,
          },
          {
            schemaName: "public",
            tableName: "orders",
            columnName: "id",
            dataType: "uuid",
            nullable: false,
            defaultValue: "gen_random_uuid()",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{
          schemaName: "public",
          tableName: "orders",
          indexName: "orders_pkey",
          definition: "CREATE UNIQUE INDEX orders_pkey ON public.orders USING btree (id)",
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          schemaName: "public",
          tableName: "orders",
          constraintName: "orders_pkey",
          constraintType: "primaryKey",
          definition: "PRIMARY KEY (id)",
        }],
      })
      .mockResolvedValueOnce({
        rows: [
          { schemaName: "public", enumName: "order_state", enumValue: "draft", sortOrder: 1 },
          { schemaName: "public", enumName: "order_state", enumValue: "sent", sortOrder: 2 },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{
          schemaName: "public",
          sequenceName: "order_number_seq",
          dataType: "bigint",
          startValue: "1000",
          minimumValue: "1",
          maximumValue: "9223372036854775807",
          incrementValue: "1",
          cacheValue: "1",
          cycle: false,
          owner: "public.orders.order_number",
        }, {
          schemaName: "drizzle",
          sequenceName: "__drizzle_migrations_id_seq",
          dataType: "integer",
          startValue: "1",
          minimumValue: "1",
          maximumValue: "2147483647",
          incrementValue: "1",
          cacheValue: "1",
          cycle: false,
          owner: "drizzle.__drizzle_migrations.id",
        }],
      })
      .mockResolvedValueOnce({ rows: [] });
    pgClient.end.mockReset().mockResolvedValue(undefined);
  });

  it("reads normalized metadata in a bounded read-only transaction", async () => {
    await expect(readSchemaCatalog("postgresql://reader:secret@db.example/app"))
      .resolves.toEqual({
        tables: [{
          schema: "public",
          name: "orders",
          columns: [
            { name: "id", dataType: "uuid", nullable: false, default: "gen_random_uuid()" },
            { name: "status", dataType: "text", nullable: true, default: null },
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
        enums: [{ schema: "public", name: "order_state", values: ["draft", "sent"] }],
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
      });

    const statements = pgClient.query.mock.calls.map(([statement]) => String(statement));
    expect(pgClient.construct).toHaveBeenCalledWith({
      connectionString: "postgresql://reader:secret@db.example/app",
      connectionTimeoutMillis: 10000,
    });
    expect(statements[0]).toBe(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    expect(statements[1]).toBe("SET LOCAL statement_timeout = 15000");
    expect(statements.at(-1)).toBe("ROLLBACK");
    expect(statements.slice(2, -1)).toHaveLength(5);
    expect(statements.slice(2, -1).every((statement) => (
      /pg_catalog|information_schema/i.test(statement) &&
      !/last_value|SELECT\s+\*/i.test(statement)
    ))).toBe(true);
    for (const statement of statements.slice(2, -1).filter((value) => (
      value.includes("extension_dependency")
    ))) {
      expect(statement).toMatch(/refclassid\s*=\s*'pg_extension'::regclass/i);
    }
    expect(statements[6]).toMatch(
      /owner_namespace\.nspname\s*=\s*'drizzle'[\s\S]*owner_relation\.relname\s*=\s*'__drizzle_migrations'/i,
    );
    expect(pgClient.end).toHaveBeenCalledOnce();
  });

  it("does not expose the supplied URL or password when catalog reading fails", async () => {
    const suppliedUrl = "postgresql://reader:top-secret@db.example/app";
    pgClient.connect.mockRejectedValueOnce(new Error(`could not connect to ${suppliedUrl}`));

    const error = await readSchemaCatalog(suppliedUrl).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Schema catalog could not be read");
    expect((error as Error).message).not.toContain(suppliedUrl);
    expect((error as Error).message).not.toContain("top-secret");
  });

  it("sanitizes constructor, query, rollback, and end failures", async () => {
    const suppliedUrl = "postgresql://reader:top-secret@db.example/app";
    const assertSafeFailure = async () => {
      const error = await readSchemaCatalog(suppliedUrl).catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Schema catalog could not be read");
      expect((error as Error).message).not.toContain(suppliedUrl);
      expect((error as Error).message).not.toContain("top-secret");
    };

    pgClient.construct.mockImplementationOnce(() => {
      throw new Error(`constructor exposed ${suppliedUrl}`);
    });
    await assertSafeFailure();

    pgClient.construct.mockReset();
    pgClient.query.mockReset()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error(`query exposed ${suppliedUrl}`))
      .mockResolvedValue({ rows: [] });
    await assertSafeFailure();

    pgClient.query.mockReset().mockImplementation(async (statement: string) => {
      if (statement === "ROLLBACK") {
        throw new Error(`rollback exposed ${suppliedUrl}`);
      }
      return { rows: [] };
    });
    await assertSafeFailure();

    pgClient.query.mockReset().mockResolvedValue({ rows: [] });
    pgClient.end.mockRejectedValueOnce(new Error(`end exposed ${suppliedUrl}`));
    await assertSafeFailure();
  });
});
