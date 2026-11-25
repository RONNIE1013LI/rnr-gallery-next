import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("production authentication plugin boundaries", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("keeps Magic Link out of the database-backed OAuth configuration", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", undefined);
    vi.stubEnv("BETTER_AUTH_URL", "https://staging.rnrgallery.com");
    vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(32).toString("hex"));
    vi.stubEnv("DATABASE_URL", "postgresql://fixture:fixture@127.0.0.1:1/rnr_auth_config_test");
    vi.stubEnv("GOOGLE_CLIENT_ID", "local-auth-test");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", randomBytes(32).toString("hex"));

    const { auth } = await import("@/server/auth");
    const pluginIds = auth.options.plugins?.map((plugin) => plugin.id) ?? [];

    expect(auth.options.verification?.storeInDatabase).toBe(true);
    expect(auth.options.socialProviders?.google).toMatchObject({ clientId: "local-auth-test" });
    expect(auth.options.emailAndPassword?.enabled).toBe(true);
    expect(pluginIds).toEqual(expect.arrayContaining(["two-factor", "passkey"]));
    expect(pluginIds).not.toContain("magic-link");
    expect(pluginIds).not.toContain("generic-oauth");
    expect(pluginIds).not.toContain("oauth-proxy");
  });
});
