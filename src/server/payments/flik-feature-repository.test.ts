import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { createDrizzleFlikFeatureRepository, FLIK_MIGRATION_SHA256, registeredFlikMigration,
  verifyFlikMigrationCatalog, type FlikFeatureMutation } from "./flik-feature-repository";

const input: FlikFeatureMutation = { status: "internal_verification", expectedStatus: "disabled",
  actor: { userId: "admin", email: "admin@example.test" }, idempotencyKey: "test-change-key" };
function mockDatabase(selections: unknown[][] = []) {
  const limit = vi.fn();
  for (const rows of selections) limit.mockResolvedValueOnce(rows);
  limit.mockResolvedValue([]);
  const select = { from: vi.fn(), where: vi.fn(), for: vi.fn(), limit };
  select.from.mockReturnValue(select); select.where.mockReturnValue(select); select.for.mockReturnValue(select);
  const values = vi.fn(() => ({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }));
  const transaction = { select: vi.fn(() => select), insert: vi.fn(() => ({ values })), execute: vi.fn().mockResolvedValue({ rows: [] }) };
  const database = { ...transaction, transaction: vi.fn(async (run: (tx: typeof transaction) => unknown) => run(transaction)) };
  return { repository: createDrizzleFlikFeatureRepository(database as never), database, transaction, values, limit };
}

describe("private Flik feature state", () => {
  it("defaults only an absent state row to disabled", async () => {
    await expect(mockDatabase([[]]).repository.readState()).resolves.toBe("disabled");
  });
  it.each([{ status: null }, { status: "unexpected" }])("reports corrupted stored values to the fail-closed service: %j", async (rows) => {
    await expect(mockDatabase([[rows]]).repository.readState()).rejects.toThrow("Invalid Flik");
  });
  it("reports storage failure so the service can mark readiness unavailable", async () => {
    const { repository, limit } = mockDatabase(); limit.mockRejectedValueOnce(new Error("offline"));
    await expect(repository.readState()).rejects.toThrow("offline");
  });
  it("stores only the private key and status, with an audit in the same transaction", async () => {
    const { repository, database, values } = mockDatabase([[], []]);
    await expect(repository.setState(input)).resolves.toBe("internal_verification");
    expect(database.transaction).toHaveBeenCalledOnce();
    expect(values).toHaveBeenNthCalledWith(1, expect.objectContaining({ key: "payments.flik.status", publishedValue: "internal_verification", publishedBy: "admin" }));
    expect(values).toHaveBeenNthCalledWith(2, expect.objectContaining({ action: "payments.flik.status.changed",
      beforeSummary: { status: "disabled" }, afterSummary: { status: "internal_verification", liveVerificationConfirmed: false }, result: "success" }));
  });
  it("refuses stale state before any mutation", async () => {
    const { repository, values } = mockDatabase([[{ status: "live" }], []]);
    await expect(repository.setState(input)).rejects.toThrow("settings changed");
    expect(values).not.toHaveBeenCalled();
  });
  it("deduplicates the same mutation, but rejects reusing its key for a different mutation", async () => {
    const audit = { before: { status: "disabled" }, after: { status: "internal_verification" } };
    const same = mockDatabase([[{ status: "internal_verification" }], [audit]]);
    await expect(same.repository.setState(input)).resolves.toBe("internal_verification");
    expect(same.values).not.toHaveBeenCalled();
    const changed = mockDatabase([[{ status: "internal_verification" }], [audit]]);
    await expect(changed.repository.setState({ ...input, status: "live", expectedStatus: "internal_verification", liveVerificationConfirmed: true })).rejects.toThrow("settings changed");
    expect(changed.values).not.toHaveBeenCalled();
  });
  it("requires internal verification state and explicit confirmation before live", async () => {
    const { repository, database } = mockDatabase();
    await expect(repository.setState({ ...input, status: "live", liveVerificationConfirmed: true })).rejects.toThrow("Invalid Flik");
    await expect(repository.setState({ ...input, status: "live", expectedStatus: "internal_verification" })).rejects.toThrow("Invalid Flik");
    expect(database.transaction).not.toHaveBeenCalled();
  });
  it("records the live confirmation in the same audit transaction", async () => {
    const { repository, values } = mockDatabase([[{ status: "internal_verification" }], []]);
    await expect(repository.setState({ ...input, status: "live", expectedStatus: "internal_verification", liveVerificationConfirmed: true })).resolves.toBe("live");
    expect(values).toHaveBeenNthCalledWith(2, expect.objectContaining({ afterSummary: { status: "live", liveVerificationConfirmed: true } }));
  });
  it("rejects invalid states before opening a transaction", async () => {
    const { repository, database } = mockDatabase();
    await expect(repository.setState({ ...input, status: "anything" as never })).rejects.toThrow("Invalid Flik");
    expect(database.transaction).not.toHaveBeenCalled();
  });
});

describe("Flik migration readiness", () => {
  it("does no database I/O while the shipped journal has no registered Flik migration", async () => {
    const { repository, database } = mockDatabase();
    await expect(repository.migrationReady()).resolves.toBe(false);
    expect(database.execute).not.toHaveBeenCalled();
    expect(database.select).not.toHaveBeenCalled();
  });
  it("requires exactly one valid journal registration", () => {
    expect(registeredFlikMigration([])).toBeNull();
    expect(registeredFlikMigration([{ tag: "draft_flik_checkout", when: 0 }])).toBeNull();
    const entry = { tag: "0071_flik_checkout", when: 1790000000000 };
    expect(registeredFlikMigration([entry])).toEqual(entry);
    expect(registeredFlikMigration([entry, { ...entry, tag: "0072_flik_checkout" }])).toBeNull();
  });
  it("checks the exact frozen hash and timestamp using catalogs, without reading Flik records", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ ready: true }] });
    await expect(verifyFlikMigrationCatalog({ execute } as never, { tag: "0071_flik_checkout", when: 1790000000000 })).resolves.toBe(true);
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(query.params).toContain(FLIK_MIGRATION_SHA256);
    expect(query.params).toContain(1790000000000);
    expect(query.sql).toContain("drizzle.__drizzle_migrations");
    expect(query.sql).toContain("pg_constraint");
    expect(query.sql).not.toMatch(/from\s+(?:public\.)?flik_checkout_sessions/i);
    expect(query.sql).not.toMatch(/from\s+(?:public\.)?flik_webhook_events/i);
  });
  it("fails closed on a partial migration or catalog access error", async () => {
    const entry = { tag: "0071_flik_checkout", when: 1790000000000 };
    await expect(verifyFlikMigrationCatalog({ execute: vi.fn().mockResolvedValue({ rows: [{ ready: false }] }) } as never, entry)).resolves.toBe(false);
    await expect(verifyFlikMigrationCatalog({ execute: vi.fn().mockRejectedValue(new Error("relation missing")) } as never, entry)).resolves.toBe(false);
  });
});
