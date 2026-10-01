import { describe, it, expect, vi } from "vitest";
import { createFlikSessionService, flikPaymentResult } from "./flik-session-service";
import { createFlikReconciliation } from "./flik-reconciliation";
import { createFlikProvider } from "./flik-provider";
import type { EnabledFlikConfig } from "./flik-config";
import type { FlikRepository, FlikSessionRecord } from "./flik-repository";
import type { FlikRetrievedSession } from "./flik-client";

const id = "00000000-0000-4000-8000-000000000001";
const config: EnabledFlikConfig = { enabled: true, mode: "live", testMode: false, deployment: "production",
  clientId: "flik_live_cid_fixture", clientSecret: "flik_live_sk_fixture", webhookSecret: "whsec_fixture" };
const row: FlikSessionRecord = { id, paymentAttemptId: id, orderId: id, merchantReference: "PAY-EXAMPLE",
  adminUserId: null, testMode: false, market: "NZ", billingCountry: "NZ", deliveryCountry: "NZ", currency: "NZD",
  expectedAmountCents: 19999, idempotencyKey: id,
  returnUrl: `https://shop.example.test/api/payments/returns/flik?state=${"a".repeat(64)}`,
  webhookUrl: "https://shop.example.test/api/payments/webhooks/flik", providerReference: "cs_fixture",
  hostedUrl: "https://app.flik.co.nz/checkout/s/opaque", providerStatus: "created", appliedAt: null,
  expiresAt: new Date("2026-10-02"), creationLeaseId: null, creationLeaseExpiresAt: null,
  createdAt: new Date("2026-10-01"), updatedAt: new Date("2026-10-01") };
const paid: FlikRetrievedSession = { id: "cs_fixture", status: "completed", amountCents: 19999, currency: "NZD",
  testMode: false, expiresAt: "2026-10-02T00:00:00Z", foreignTransactionId: id, transactionType: "open_banking" };
function fixture(overrides: Partial<FlikSessionRecord> = {}) {
  const saved = { ...row, ...overrides };
  const repository = {
    createOrGetSession: vi.fn().mockResolvedValue(saved), findSession: vi.fn().mockResolvedValue(saved),
    findSessionByProviderReference: vi.fn().mockResolvedValue(saved),
    claimSessionCreation: vi.fn().mockResolvedValue({ session: saved, claimId: "claim" }),
    bindSession: vi.fn().mockResolvedValue(row), releaseSessionCreation: vi.fn().mockResolvedValue(undefined),
    updateVerifiedSession: vi.fn().mockResolvedValue(saved), markSessionApplied: vi.fn().mockResolvedValue(undefined),
    recoverLiveAttemptBinding: vi.fn().mockResolvedValue(undefined),
    listPendingSessions: vi.fn().mockResolvedValue([saved]), listPendingWebhooks: vi.fn().mockResolvedValue([]),
    markWebhookProcessed: vi.fn().mockResolvedValue(undefined), receiveWebhook: vi.fn(),
    deferSession: vi.fn(), deferWebhook: vi.fn(),
  } satisfies FlikRepository;
  const client = { createSession: vi.fn().mockResolvedValue({ ...paid, url: row.hostedUrl }), retrieveSession: vi.fn().mockResolvedValue(paid) };
  const sessions = createFlikSessionService({ config, repository, client });
  return { saved, repository, client, sessions };
}

describe("Flik session and completion integration", () => {
  it("leaves queued work untouched when the reconciliation budget is exhausted", async () => {
    const { repository, sessions, client } = fixture();
    repository.listPendingWebhooks.mockResolvedValue([{ transactionId: "txn", foreignTransactionId: id, checkoutSessionId: "cs_fixture" }]);
    const applyLiveResult = vi.fn();
    expect(await createFlikReconciliation({ repository, sessions, testMode: false, applyLiveResult, deadlineMs: 100, now: () => 100 }).run()).toEqual({ processed: 0, confirmed: 0, pending: 0 });
    expect(client.retrieveSession).not.toHaveBeenCalled();
    expect(repository.markWebhookProcessed).not.toHaveBeenCalled();
    expect(repository.markSessionApplied).not.toHaveBeenCalled();
    expect(applyLiveResult).not.toHaveBeenCalled();
  });
  it("reuses the persisted URL rather than creating a second provider session", async () => {
    const { sessions, client } = fixture();
    expect((await sessions.start(row)).hostedUrl).toBe(row.hostedUrl);
    expect(client.createSession).not.toHaveBeenCalled();
  });
  it("persists the opaque URL before any further I/O", async () => {
    const { saved, sessions, repository, client } = fixture({ providerReference: null, hostedUrl: null });
    await sessions.start(saved);
    expect(repository.bindSession).toHaveBeenCalledWith(expect.objectContaining({ id, providerReference: "cs_fixture", hostedUrl: row.hostedUrl }));
    expect(client.retrieveSession).not.toHaveBeenCalled();
    expect(client.createSession).toHaveBeenCalledWith(expect.objectContaining({ snapshot: { attemptId: id, amountCents: 19999, currency: "NZD", testMode: false }, redirectUrl: row.returnUrl, webhookUrl: row.webhookUrl }));
  });
  it("does not interpret a creation timeout as failed or retry under another key", async () => {
    const { saved, sessions, repository, client } = fixture({ providerReference: null, hostedUrl: null });
    client.createSession.mockRejectedValue(new Error("timeout"));
    await expect(sessions.start(saved)).rejects.toThrow();
    expect(client.createSession).toHaveBeenCalledTimes(1);
    expect(repository.releaseSessionCreation).toHaveBeenCalledWith(id, "claim");
    expect(repository.updateVerifiedSession).not.toHaveBeenCalled();
  });
  it("does not create while another request owns the lease", async () => {
    const { saved, sessions, repository, client } = fixture({ providerReference: null, hostedUrl: null });
    repository.claimSessionCreation.mockResolvedValue({ session: saved, claimId: null });
    await sessions.start(saved);
    expect(client.createSession).not.toHaveBeenCalled();
  });
  it.each(["created", "pending", "failed", "unrecognised"])("keeps %s pending", (status) => {
    expect(flikPaymentResult(row, { ...paid, status }).status).toBe("processing");
  });
  it("expires only on authoritative expiry and includes live snapshot evidence on success", () => {
    expect(flikPaymentResult(row, { ...paid, status: "expired" }).status).toBe("cancelled");
    expect(flikPaymentResult(row, paid)).toMatchObject({ status: "paid", testMode: false, foreignTransactionId: id });
  });
  it("rejects a test snapshot before any provider query in the live runtime", async () => {
    const { sessions, client } = fixture();
    await expect(sessions.retrieve({ ...row, testMode: true })).rejects.toThrow();
    expect(client.retrieveSession).not.toHaveBeenCalled();
  });
  it("recovers missing return/webhook and applies through the existing order completion repository", async () => {
    const { repository, sessions } = fixture();
    const applyLiveResult = vi.fn().mockResolvedValue(undefined);
    await createFlikReconciliation({ repository, sessions, testMode: false, applyLiveResult }).run();
    expect(repository.recoverLiveAttemptBinding).toHaveBeenCalledWith(id);
    expect(applyLiveResult).toHaveBeenCalledWith(id, expect.objectContaining({ status: "paid", testMode: false }));
    expect(repository.markSessionApplied).toHaveBeenCalledWith(id, "cs_fixture");
  });
  it("retains completion for retry when the order transaction fails", async () => {
    const { repository, sessions } = fixture();
    const applyLiveResult = vi.fn().mockRejectedValue(new Error("database unavailable"));
    expect((await createFlikReconciliation({ repository, sessions, testMode: false, applyLiveResult }).run()).pending).toBe(1);
    expect(repository.markSessionApplied).not.toHaveBeenCalled();
  });
  it("does not mark API timeouts or amount mismatches paid", async () => {
    const { repository, sessions, client } = fixture();
    client.retrieveSession.mockRejectedValue(new Error("unverified provider result"));
    const applyLiveResult = vi.fn();
    await createFlikReconciliation({ repository, sessions, testMode: false, applyLiveResult }).run();
    expect(applyLiveResult).not.toHaveBeenCalled();
    expect(repository.markSessionApplied).not.toHaveBeenCalled();
  });
  it("completed test payments never enter live completion", async () => {
    const { repository, client } = fixture({ testMode: true, paymentAttemptId: null, orderId: null, adminUserId: "test-admin" });
    client.retrieveSession.mockResolvedValue({ ...paid, testMode: true });
    const sessions = createFlikSessionService({ config: { ...config, testMode: true, mode: "test", deployment: "development" }, repository, client });
    const applyLiveResult = vi.fn();
    await createFlikReconciliation({ repository, sessions, testMode: true, applyLiveResult }).run();
    expect(applyLiveResult).not.toHaveBeenCalled();
    expect(repository.recoverLiveAttemptBinding).not.toHaveBeenCalled();
    expect(repository.markSessionApplied).toHaveBeenCalled();
  });
  it("deduplicates a queued event and periodic read in the same pass", async () => {
    const { repository, sessions } = fixture();
    repository.listPendingWebhooks.mockResolvedValue([{ transactionId: "txn", foreignTransactionId: id, checkoutSessionId: "cs_fixture" }]);
    const applyLiveResult = vi.fn();
    await createFlikReconciliation({ repository, sessions, testMode: false, applyLiveResult }).run();
    expect(applyLiveResult).toHaveBeenCalledTimes(1);
    expect(repository.markWebhookProcessed).toHaveBeenCalledWith("txn");
  });
  it("does not trust a signed event with a different session association", async () => {
    const { repository, sessions } = fixture();
    repository.listPendingWebhooks.mockResolvedValue([{ transactionId: "txn", foreignTransactionId: id, checkoutSessionId: "cs_other" }]);
    repository.listPendingSessions.mockResolvedValue([]);
    const applyLiveResult = vi.fn();
    await createFlikReconciliation({ repository, sessions, testMode: false, applyLiveResult }).run();
    expect(applyLiveResult).not.toHaveBeenCalled();
    expect(repository.markWebhookProcessed).not.toHaveBeenCalled();
  });
  it("does not register test credentials as an ordinary Checkout provider", async () => {
    const provider = createFlikProvider({ config: { ...config, testMode: true, mode: "test", deployment: "development" } });
    expect(await provider.availability({ market: "NZ", currency: "NZD", amountCents: 100, customer: { fullName: "", email: "", phone: "" }, billingAddress: null, deliveryAddress: null })).toMatchObject({ available: false });
    await expect(provider.retrieve({ order: {} as never, providerReference: "cs_fixture" })).rejects.toThrow();
  });
});
