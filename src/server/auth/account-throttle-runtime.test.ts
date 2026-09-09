// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ eval: vi.fn(), getSession: vi.fn() }));
vi.mock("@upstash/redis", () => ({ Redis: class { eval = fake.eval; } }));
vi.mock("better-auth/api", async (original) => {
  const actual = await original<typeof import("better-auth/api")>();
  return { ...actual, createAuthMiddleware: (handler: unknown) => handler, getSessionFromCtx: fake.getSession };
});
import { createAccountThrottleHook } from "./account-throttle-runtime";
const env: NodeJS.ProcessEnv = { NODE_ENV: "test", RNR_AI_REDIS_REST_URL: "https://synthetic-redis.invalid", RNR_AI_REDIS_REST_TOKEN: "synthetic", RNR_AI_REDIS_NAMESPACE: "test-security", BETTER_AUTH_SECRET: "synthetic-test-only-secret-longer-than-32" };
beforeEach(() => { fake.eval.mockReset().mockResolvedValue(1); fake.getSession.mockReset().mockResolvedValue(null); });
function context(path: string, body: object = {}) {
  return { path, body, getSignedCookie: vi.fn().mockResolvedValue("synthetic-pending-cookie"), context: {
    secret: env.BETTER_AUTH_SECRET, createAuthCookie: () => ({ name: "two_factor" }),
    internalAdapter: { findVerificationValue: vi.fn().mockResolvedValue({ value: "synthetic-user" }) },
    adapter: { findOne: vi.fn().mockResolvedValue({ userId: "synthetic-user" }) },
  } };
}
describe("account throttle auth hook", () => {
  it("binds password-pending MFA attempts to the account and rejects over limit", async () => {
    fake.eval.mockResolvedValue(11);
    const hook = createAccountThrottleHook(env);
    await expect(hook(context("/two-factor/verify-totp", { code: "123456" }) as never)).rejects.toMatchObject({ status: "TOO_MANY_REQUESTS" });
    expect(fake.eval).toHaveBeenCalledWith(expect.any(String), [expect.stringMatching(/^test-security:rnr:auth-account:v1:[a-f0-9]{64}$/)], [900]);
  });
  it("resolves a Passkey's account before consuming its attempt bucket", async () => {
    const hook = createAccountThrottleHook(env); const ctx = context("/passkey/verify-authentication", { response: { id: "synthetic-credential" } });
    await hook(ctx as never);
    expect(ctx.context.adapter.findOne).toHaveBeenCalled();
    expect(fake.eval).toHaveBeenCalledOnce();
  });
  it("fails closed when Redis is unavailable without affecting session reads", async () => {
    fake.eval.mockRejectedValue(new Error("unavailable")); const hook = createAccountThrottleHook(env);
    await expect(hook(context("/sign-in/email", { email: "staff@example.test" }) as never)).rejects.toMatchObject({ status: "SERVICE_UNAVAILABLE" });
    await expect(hook(context("/get-session") as never)).resolves.toBeUndefined();
  });
});
