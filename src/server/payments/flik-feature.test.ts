// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createFlikFeatureService } from "./flik-feature";
import type { FlikFeatureStatus } from "./flik-feature";
const readyEnv = { VERCEL_ENV: "production", NODE_ENV: "production", ENABLE_FLIK_PAYMENTS: "true", FLIK_MODE: "live", FLIK_CLIENT_ID: "flik_live_cid_fixture", FLIK_CLIENT_SECRET: "flik_live_sk_fixture", FLIK_WEBHOOK_SECRET: "whsec_fixture", PAYMENT_RETURN_BASE_URL: "https://rnrgallery.com", CRON_SECRET: "fixture-cron" };
const actor = { userId: "admin-1", email: "owner@example.test", role: "admin" as const };
const change = { status: "internal_verification" as const, expectedStatus: "disabled" as const, idempotencyKey: "10000000-0000-4000-8000-000000000001" };
function setup(env: Record<string, string | undefined> = readyEnv) {
  let status: FlikFeatureStatus = "disabled";
  const repository = {
    readState: vi.fn(async () => status), migrationReady: vi.fn(async () => true),
    setState: vi.fn(async (input: { status: FlikFeatureStatus }) => { status = input.status; return status; }),
  };
  return { repository, service: createFlikFeatureService({ repository, env }) };
}
describe("Flik feature readiness and owner transitions", () => {
  it("defaults disabled even when every readiness item passes", async () => {
    const { service, repository } = setup();
    expect(await service.getSnapshot()).toMatchObject({ status: "disabled", ready: true, canManage: false });
    expect(repository.setState).not.toHaveBeenCalled();
  });
  it("persists only an explicit owner transition and its audit actor", async () => {
    const { service, repository } = setup();
    expect(await service.transition(change, actor)).toMatchObject({ status: "internal_verification", canManage: true });
    expect(repository.setState).toHaveBeenCalledWith({ ...change, actor: { userId: actor.userId, email: actor.email } });
  });
  it.each(["internal_verification", "live"] as const)("refuses %s without the required database migration", async (status) => {
    const { service, repository } = setup();
    repository.migrationReady.mockResolvedValue(false);
    await expect(service.transition({ ...change, status }, actor)).rejects.toMatchObject({ status: 409 });
    expect(repository.setState).not.toHaveBeenCalled();
  });
  it.each([
    { VERCEL_ENV: "preview" }, { ENABLE_FLIK_PAYMENTS: "false" }, { FLIK_MODE: "test" },
    { FLIK_CLIENT_ID: "flik_test_cid_fixture" }, { FLIK_CLIENT_SECRET: undefined },
    { FLIK_WEBHOOK_SECRET: undefined }, { CRON_SECRET: undefined },
    { PAYMENT_RETURN_BASE_URL: "https://evil.example" }, { PAYMENT_RETURN_BASE_URL: "http://rnrgallery.com" },
  ])("recomputes and rejects missing or conflicting runtime requirements %o", async (missing) => {
    const { service, repository } = setup({ ...readyEnv, ...missing });
    await expect(service.transition(change, actor)).rejects.toMatchObject({ status: 409 });
    expect(repository.setState).not.toHaveBeenCalled();
  });
  it("rejects a direct Disabled to Live transition even with owner confirmation", async () => {
    const { service, repository } = setup();
    await expect(service.transition({ ...change, status: "live", liveVerificationConfirmed: true }, actor)).rejects.toMatchObject({ status: 409 });
    expect(repository.setState).not.toHaveBeenCalled();
  });
  it("requires explicit owner verification after Internal verification before Live", async () => {
    const { service, repository } = setup();
    await service.transition(change, actor);
    const live = { ...change, status: "live" as const, expectedStatus: "internal_verification" as const, idempotencyKey: "10000000-0000-4000-8000-000000000002" };
    await expect(service.transition(live, actor)).rejects.toMatchObject({ status: 409 });
    expect(repository.setState).toHaveBeenCalledTimes(1);
    expect(await service.transition({ ...live, liveVerificationConfirmed: true }, actor)).toMatchObject({ status: "live" });
    expect(repository.setState).toHaveBeenLastCalledWith(expect.objectContaining({ status: "live", liveVerificationConfirmed: true }));
  });
  it("permits disabling despite missing configuration and unavailable migration", async () => {
    const { service, repository } = setup({});
    repository.migrationReady.mockRejectedValue(new Error("private database details"));
    expect(await service.transition({ ...change, status: "disabled" }, actor)).toMatchObject({ status: "disabled", ready: false });
    expect(repository.setState).toHaveBeenCalledOnce();
  });
  it("does not allow a payment-managing staff member to change availability", async () => {
    const { service, repository } = setup();
    await expect(service.transition(change, { ...actor, role: "staff" })).rejects.toMatchObject({ status: 403 });
    expect(repository.setState).not.toHaveBeenCalled();
  });
  it("fails closed when state reads fail and exposes no credentials", async () => {
    const { service, repository } = setup();
    repository.readState.mockRejectedValue(new Error("private database details"));
    const snapshot = await service.getSnapshot();
    expect(snapshot).toMatchObject({ status: "disabled", ready: false });
    const serialized = JSON.stringify(snapshot);
    for (const secret of [readyEnv.FLIK_CLIENT_ID, readyEnv.FLIK_CLIENT_SECRET, readyEnv.FLIK_WEBHOOK_SECRET, readyEnv.CRON_SECRET, "private database"]) expect(serialized).not.toContain(secret);
  });
});
