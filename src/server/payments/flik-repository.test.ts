import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { flikCheckoutSessions, flikWebhookEvents } from "@/server/db/schema/flik";
import {
  assertFlikSnapshot, assertMatchingFlikSnapshot, createDrizzleFlikRepository,
  nextFlikProviderStatus, type FlikSessionRecord, type FlikSessionSnapshot,
} from "./flik-repository";

const id = "00000000-0000-4000-8000-000000000001";
const snapshot: FlikSessionSnapshot = {
  id, paymentAttemptId: null, orderId: null, merchantReference: `FLIK-TEST-${id}`,
  adminUserId: "admin-1", testMode: true, market: "NZ", billingCountry: "NZ", deliveryCountry: "NZ",
  currency: "NZD", expectedAmountCents: 100, idempotencyKey: id,
  returnUrl: "https://shop.example.test/admin/settings/payment", webhookUrl: "https://shop.example.test/api/payments/webhooks/flik",
};
const session: FlikSessionRecord = {
  ...snapshot, hostedUrl: null, providerReference: null, providerStatus: "created", appliedAt: null,
  expiresAt: null, creationLeaseId: null, creationLeaseExpiresAt: null,
  createdAt: new Date("2026-10-01T00:00:00Z"), updatedAt: new Date("2026-10-01T00:00:00Z"),
};
function mockDatabase(selected: unknown[], inserted: unknown[] = []) {
  const selectChain = { where: vi.fn(), for: vi.fn(), limit: vi.fn().mockResolvedValue(selected) };
  selectChain.where.mockReturnValue(selectChain); selectChain.for.mockReturnValue(selectChain);
  const set = vi.fn((values: unknown) => { void values; return { where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue(selected) })) }; });
  const tx = {
    select: vi.fn(() => ({ from: vi.fn(() => selectChain) })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ onConflictDoNothing: vi.fn(() => ({ returning: vi.fn().mockResolvedValue(inserted) })) })) })),
    update: vi.fn(() => ({ set })),
    execute: vi.fn((_query: import("drizzle-orm").SQL) => { void _query; return Promise.resolve({ rows: [{ now: new Date("2026-10-01T00:00:30Z") }] }); }),
  };
  const db = { ...tx, transaction: vi.fn(async (fn: (transaction: typeof tx) => unknown) => fn(tx)) };
  return { repository: createDrizzleFlikRepository(db as never), tx, set, selectChain };
}

describe("Flik persistence safety", () => {
  it("accepts an isolated admin test snapshot and an order-linked live snapshot", () => {
    expect(() => assertFlikSnapshot(snapshot)).not.toThrow();
    expect(() => assertFlikSnapshot({ ...snapshot, paymentAttemptId: id, orderId: id, testMode: false, adminUserId: null })).not.toThrow();
  });
  it.each([
    { market: "AU" }, { currency: "AUD" }, { billingCountry: "AU" }, { deliveryCountry: "" },
    { expectedAmountCents: 0 }, { expectedAmountCents: 1.5 }, { expectedAmountCents: 1_000_001 },
    { testMode: true, paymentAttemptId: id }, { testMode: true, orderId: id }, { adminUserId: null },
    { testMode: false, paymentAttemptId: id, adminUserId: null },
  ])("rejects unsafe market/money/commerce target: %j", (overrides) => {
    expect(() => assertFlikSnapshot({ ...snapshot, ...overrides })).toThrow();
  });
  it.each([
    { expectedAmountCents: 200 }, { adminUserId: "another-admin" }, { returnUrl: "https://other.test/return" },
    { webhookUrl: "https://other.test/hook" }, { merchantReference: "different-order" }, { idempotencyKey: "another-key" },
  ])("rejects a reused id with a changed immutable body or owner: %j", (overrides) => {
    expect(() => assertMatchingFlikSnapshot(snapshot, { ...snapshot, ...overrides })).toThrow();
  });
  it("never downgrades completed payments but allows failed sessions to be retried", () => {
    for (const incoming of ["pending", "failed", "expired", "created", "unknown"]) expect(nextFlikProviderStatus("completed", incoming)).toBe("completed");
    expect(nextFlikProviderStatus("failed", "pending")).toBe("pending");
    expect(nextFlikProviderStatus("failed", "completed")).toBe("completed");
    expect(() => nextFlikProviderStatus("created", "paid")).toThrow();
  });
  it("keeps duplicate signed receipts durable and rejects altered payloads", async () => {
    const event = { transactionId: "txn-test", payloadSha256: "a".repeat(64), checkoutSessionId: "cs_test", foreignTransactionId: id };
    await expect(mockDatabase([], [event]).repository.receiveWebhook(event)).resolves.toBe("accepted");
    await expect(mockDatabase([event]).repository.receiveWebhook(event)).resolves.toBe("duplicate");
    await expect(mockDatabase([event]).repository.receiveWebhook({ ...event, payloadSha256: "b".repeat(64) })).resolves.toBe("conflict");
    await expect(mockDatabase([event]).repository.receiveWebhook({ ...event, checkoutSessionId: "cs_other" })).resolves.toBe("conflict");
  });
  it("bounds inbox database statement and lock waits before acknowledging persistence", async () => {
    const event = { transactionId: "txn-test", payloadSha256: "a".repeat(64), checkoutSessionId: "cs_test", foreignTransactionId: id };
    const { repository, tx } = mockDatabase([], [event]);
    await repository.receiveWebhook(event);
    const dialect = new PgDialect();
    const settings = tx.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query).sql);
    expect(settings).toEqual(["set local statement_timeout = '2000ms'", "set local lock_timeout = '1000ms'"]);
    expect(tx.execute.mock.invocationCallOrder[1]).toBeLessThan(tx.insert.mock.invocationCallOrder[0]);
  });
  it("defers uncertain sessions and inbox events without declaring them complete", async () => {
    const { repository, set } = mockDatabase([]);
    await repository.deferSession(id);
    await repository.deferWebhook("txn-test");
    expect(set).toHaveBeenCalledTimes(2);
    for (const [values] of set.mock.calls) {
      expect(Object.keys(values as object)).toEqual(["updatedAt"]);
    }
  });
  it("does not recreate a session while a creation claim is live", async () => {
    const { repository, tx } = mockDatabase([{ ...session, creationLeaseId: id, creationLeaseExpiresAt: new Date("2026-10-01T00:01:00Z") }]);
    await expect(repository.claimSessionCreation(id)).resolves.toMatchObject({ claimId: null });
    expect(tx.update).not.toHaveBeenCalled();
  });
  it("refuses creation replay outside the provider idempotency window", async () => {
    const { repository, tx } = mockDatabase([{ ...session, createdAt: new Date("2026-09-30T00:00:00Z") }]);
    await expect(repository.claimSessionCreation(id)).resolves.toMatchObject({ claimId: null });
    expect(tx.update).not.toHaveBeenCalled();
  });
  it("refuses a stale lease binding and mismatched verified provider session", async () => {
    const { repository, tx } = mockDatabase([{ ...session, creationLeaseId: "other-claim" }]);
    await expect(repository.bindSession({ id, claimId: id, providerReference: "cs_test", hostedUrl: "https://app.flik.co.nz/test", expiresAt: new Date("2026-10-02") })).rejects.toThrow();
    await expect(repository.updateVerifiedSession(id, "cs_other", "completed")).rejects.toThrow();
    expect(tx.update).not.toHaveBeenCalled();
  });
  it("does not mark pending payments applied", async () => {
    const { repository, tx } = mockDatabase([{ ...session, providerReference: "cs_test", providerStatus: "pending" }]);
    await expect(repository.markSessionApplied(id, "cs_test")).rejects.toThrow();
    expect(tx.update).not.toHaveBeenCalled();
  });
  it("recovers a provider-bound live attempt without completing the order", async () => {
    const row = { ...session, testMode: false, paymentAttemptId: id, orderId: id, adminUserId: null,
      providerReference: "cs_test", returnUrl: `${snapshot.returnUrl}?state=${"a".repeat(64)}` };
    const order = { id, market: "NZ", currency: "NZD", totalInclGstCents: 100, paymentReference: row.merchantReference,
      orderNumber: row.merchantReference, paymentStatus: "awaiting_payment" };
    const attempt = { id, orderId: id, paymentRequestId: null, provider: "flik", method: "flik", expectedAmountCents: 100,
      currency: "NZD", country: "NZ", providerReference: null, returnStateDigest: null, status: "created" };
    const { repository, set, selectChain } = mockDatabase([]);
    selectChain.limit.mockResolvedValueOnce([row]).mockResolvedValueOnce([order]).mockResolvedValueOnce([attempt]).mockResolvedValueOnce([row]);
    await repository.recoverLiveAttemptBinding(id);
    expect(set).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ providerReference: "cs_test", status: "requires_action", providerSessionLeaseId: null }));
    expect(set.mock.calls[0][0]).not.toHaveProperty("paymentStatus");
    expect(set.mock.calls[0][0]).not.toHaveProperty("orderNumber");
  });
  it("never binds test metadata into commerce payment attempts", async () => {
    const { repository, tx } = mockDatabase([session]);
    await expect(repository.recoverLiveAttemptBinding(id)).rejects.toThrow();
    expect(tx.update).not.toHaveBeenCalled();
  });
  it("enforces test separation in schema and retains completed work until applied", () => {
    const config = getTableConfig(flikCheckoutSessions);
    const dialect = new PgDialect();
    const target = config.checks.find((check) => check.name === "flik_checkout_sessions_target_valid")!;
    const sql = dialect.sqlToQuery(target.value).sql;
    expect(sql).toContain('"payment_attempt_id" IS NULL');
    expect(sql).toContain('"order_id" IS NULL');
    expect(sql).toContain('"admin_user_id" IS NOT NULL');
    expect(config.foreignKeys).toHaveLength(2);
    const pending = config.indexes.find((index) => index.config.name === "flik_checkout_sessions_pending_idx")!;
    expect(dialect.sqlToQuery(pending.config.where!).sql).toContain('"applied_at" IS NULL');
    const columns = getTableConfig(flikWebhookEvents).columns.map((column) => column.name);
    for (const privateColumn of ["raw_body", "payer_name", "payer_email"]) expect(columns).not.toContain(privateColumn);
  });
});
