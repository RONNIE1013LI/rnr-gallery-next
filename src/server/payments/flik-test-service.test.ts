// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createFlikTestService } from "./flik-test-service";
import type { FlikRepository, FlikSessionRecord, FlikSessionSnapshot } from "./flik-repository";
import type { EnabledFlikConfig } from "./flik-config";
const id = "10000000-0000-4000-8000-000000000001";
const config: EnabledFlikConfig = { enabled: true, mode: "test", testMode: true, deployment: "development", clientId: "flik_test_cid_fixture", clientSecret: "flik_test_sk_fixture", webhookSecret: "whsec_fixture" };
function setup() {
  let row: FlikSessionRecord | null = null;
  const repository = {
    findSession: vi.fn(async () => row), markSessionApplied: vi.fn(),
  } as unknown as FlikRepository;
  const sessionService = {
    start: vi.fn(async (input: FlikSessionSnapshot) => {
      row = { ...input, providerReference: "cs_fixture", providerStatus: "created", hostedUrl: "https://app.flik.co.nz/checkout/s/fixture", expiresAt: new Date(), appliedAt: null, creationLeaseId: null, creationLeaseExpiresAt: null, createdAt: new Date(), updatedAt: new Date() };
      return row;
    }),
    retrieve: vi.fn(async () => ({ id: "cs_fixture", status: "completed", amountCents: 100, currency: "NZD" as const, testMode: true, foreignTransactionId: id, transactionType: "open_banking", expiresAt: new Date().toISOString() })),
  };
  const service = createFlikTestService({ config, repository, sessionService, returnOrigin: "https://isolated.example.test" });
  return { service, repository, sessionService, row: () => row!, change: (change: Partial<FlikSessionRecord>) => { row = { ...row!, ...change }; } };
}
describe("isolated admin Flik test service", () => {
  it("creates fixed server-owned test snapshots with no commerce records", async () => {
    const { service, sessionService } = setup();
    await service.start("admin-1", id);
    expect(sessionService.start).toHaveBeenCalledWith(expect.objectContaining({ expectedAmountCents: 100, currency: "NZD", market: "NZ", billingCountry: "NZ", deliveryCountry: "NZ", testMode: true, paymentAttemptId: null, orderId: null, adminUserId: "admin-1", idempotencyKey: id, returnUrl: `https://isolated.example.test/admin/settings/payment/flik?sessionId=${id}` }));
  });
  it("marks only test-session reconciliation on verified success and hides its payer URL", async () => {
    const { service, repository } = setup();
    await service.start("admin-1", id);
    expect(await service.confirm("admin-1", id)).toEqual({ id, status: "completed" });
    expect(repository.markSessionApplied).toHaveBeenCalledWith(id, "cs_fixture");
  });
  it("refuses access to another administrator's session", async () => {
    const { service, sessionService } = setup();
    await service.start("admin-1", id);
    await expect(service.confirm("admin-2", id)).rejects.toMatchObject({ status: 404 });
    await expect(service.start("admin-2", id)).rejects.toMatchObject({ status: 404 });
    expect(sessionService.retrieve).not.toHaveBeenCalled();
  });
  it("refuses production and live configurations before any database or provider call", async () => {
    const { repository, sessionService } = setup();
    for (const changed of [{ ...config, deployment: "production" as const }, { ...config, mode: "live" as const, testMode: false }]) {
      const service = createFlikTestService({ config: changed, repository, sessionService, returnOrigin: "https://isolated.example.test" });
      await expect(service.start("admin-1", id)).rejects.toMatchObject({ status: 503 });
    }
    expect(repository.findSession).not.toHaveBeenCalled();
    expect(sessionService.start).not.toHaveBeenCalled();
  });
  it("keeps timeouts pending and never applies them", async () => {
    const { service, repository, sessionService } = setup();
    await service.start("admin-1", id);
    sessionService.retrieve.mockRejectedValueOnce(new Error("secret provider response"));
    expect(await service.confirm("admin-1", id)).toMatchObject({ id, status: "pending" });
    expect(repository.markSessionApplied).not.toHaveBeenCalled();
  });
  it("retains the same identifier when a create request has an ambiguous outcome", async () => {
    const { service, sessionService } = setup();
    await service.start("admin-1", id);
    sessionService.start.mockRejectedValueOnce(new Error("timeout"));
    expect(await service.start("admin-1", id)).toMatchObject({ id, status: "pending" });
  });
  it("rejects test records attached to a real order", async () => {
    const { service, change, sessionService } = setup();
    await service.start("admin-1", id);
    change({ orderId: id });
    await expect(service.confirm("admin-1", id)).rejects.toMatchObject({ status: 404 });
    expect(sessionService.retrieve).not.toHaveBeenCalled();
  });
});
