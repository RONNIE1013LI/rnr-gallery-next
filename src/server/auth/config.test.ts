import { describe, expect, it } from "vitest";

import {
  getAuthRateLimitOptions,
  getBetterAuthBaseURL,
  getLocalOAuthProxyOptions,
  parseAuthConfig,
} from "./config";

const strongSecret = "test-only-auth-secret-32-characters";

describe("parseAuthConfig", () => {
  it("uses shared database-backed rate limits for authentication", () => {
    expect(getAuthRateLimitOptions()).toEqual({
      enabled: true,
      window: 60,
      max: 100,
      storage: "database",
      modelName: "rateLimit",
    });
  });

  it.each([
    [{ BETTER_AUTH_SECRET: strongSecret }, "BETTER_AUTH_URL"],
    [
      {
        BETTER_AUTH_URL: "https://shop.example.test",
        BETTER_AUTH_SECRET: "short-secret",
      },
      "BETTER_AUTH_SECRET",
    ],
  ])("fails closed when %s is missing or weak", (env, variable) => {
    expect(() => parseAuthConfig(env)).toThrow(variable);
  });

  it("requires BETTER_AUTH_URL to be absolute", () => {
    expect(() =>
      parseAuthConfig({
        BETTER_AUTH_URL: "shop.example.test",
        BETTER_AUTH_SECRET: strongSecret,
      }),
    ).toThrow("BETTER_AUTH_URL");
  });

  it("rejects a low-entropy secret even when it meets the minimum length", () => {
    expect(() =>
      parseAuthConfig({
        BETTER_AUTH_URL: "https://shop.example.test",
        BETTER_AUTH_SECRET: "a".repeat(32),
      }),
    ).toThrow("BETTER_AUTH_SECRET");
  });

  it("requires HTTPS in production", () => {
    expect(() =>
      parseAuthConfig({
        NODE_ENV: "production",
        BETTER_AUTH_URL: "http://localhost:3000",
        BETTER_AUTH_SECRET: strongSecret,
      }),
    ).toThrow("BETTER_AUTH_URL");
  });

  it("allows localhost HTTP for development and test only", () => {
    expect(
      parseAuthConfig({
        NODE_ENV: "test",
        BETTER_AUTH_URL: "http://127.0.0.1:3000/",
        BETTER_AUTH_SECRET: strongSecret,
      }),
    ).toEqual({
      baseURL: "http://127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      secret: strongSecret,
    });

    expect(() =>
      parseAuthConfig({
        NODE_ENV: "development",
        BETTER_AUTH_URL: "http://shop.example.test",
        BETTER_AUTH_SECRET: strongSecret,
      }),
    ).toThrow("BETTER_AUTH_URL");
  });

  it("allows private LAN HTTP for development but rejects public IP HTTP", () => {
    expect(
      parseAuthConfig({
        NODE_ENV: "development",
        BETTER_AUTH_URL: "http://192.168.4.199:3000",
        BETTER_AUTH_SECRET: strongSecret,
      }),
    ).toEqual({
      baseURL: "http://192.168.4.199:3000",
      origin: "http://192.168.4.199:3000",
      secret: strongSecret,
    });

    expect(() =>
      parseAuthConfig({
        NODE_ENV: "development",
        BETTER_AUTH_URL: "http://8.8.8.8:3000",
        BETTER_AUTH_SECRET: strongSecret,
      }),
    ).toThrow("BETTER_AUTH_URL");
  });

  it.each([undefined, "staging"])(
    "rejects localhost HTTP when NODE_ENV is %s",
    (nodeEnv) => {
      expect(() =>
        parseAuthConfig({
          NODE_ENV: nodeEnv,
          BETTER_AUTH_URL: "http://localhost:3000",
          BETTER_AUTH_SECRET: strongSecret,
        }),
      ).toThrow("BETTER_AUTH_URL");
    },
  );

  it("returns a canonical HTTPS app origin for production", () => {
    expect(
      parseAuthConfig({
        NODE_ENV: "production",
        BETTER_AUTH_URL: "https://shop.example.test/",
        BETTER_AUTH_SECRET: strongSecret,
      }),
    ).toEqual({
      baseURL: "https://shop.example.test",
      origin: "https://shop.example.test",
      secret: strongSecret,
    });
  });

  it("allows Better Auth to resolve localhost callbacks during LAN development", () => {
    const config = parseAuthConfig({
      NODE_ENV: "development",
      BETTER_AUTH_URL: "http://192.168.4.199:3000",
      BETTER_AUTH_SECRET: strongSecret,
    });

    expect(getBetterAuthBaseURL(config, { NODE_ENV: "development" })).toEqual({
      allowedHosts: ["192.168.4.199:3000", "localhost:3000", "127.0.0.1:3000"],
      fallback: "http://192.168.4.199:3000",
      protocol: "http",
    });
  });

  it("keeps a static HTTPS auth origin outside development", () => {
    const config = parseAuthConfig({
      NODE_ENV: "production",
      BETTER_AUTH_URL: "https://shop.example.test",
      BETTER_AUTH_SECRET: strongSecret,
    });

    expect(getBetterAuthBaseURL(config, { NODE_ENV: "production" })).toBe(
      "https://shop.example.test",
    );
  });

  it("does not treat a private LAN origin as an OAuth proxy production URL", () => {
    const config = parseAuthConfig({
      NODE_ENV: "development",
      BETTER_AUTH_URL: "http://192.168.4.199:3000",
      BETTER_AUTH_SECRET: strongSecret,
    });

    expect(getLocalOAuthProxyOptions(config, { NODE_ENV: "development" })).toBeNull();
  });

  it("uses an explicitly configured HTTPS origin for local OAuth proxying", () => {
    const config = parseAuthConfig({
      NODE_ENV: "development",
      BETTER_AUTH_URL: "http://192.168.4.199:3000",
      BETTER_AUTH_SECRET: strongSecret,
    });

    expect(getLocalOAuthProxyOptions(config, {
      NODE_ENV: "development",
      OAUTH_PROXY_SECRET: "dedicated-proxy-secret",
      OAUTH_PROXY_URL: "https://rrgallery.co.nz",
    })).toEqual({
      productionURL: "https://rrgallery.co.nz",
      secret: "dedicated-proxy-secret",
    });
  });

  it("does not proxy OAuth for production or loopback-only development", () => {
    const production = parseAuthConfig({
      NODE_ENV: "production",
      BETTER_AUTH_URL: "https://shop.example.test",
      BETTER_AUTH_SECRET: strongSecret,
    });
    const loopback = parseAuthConfig({
      NODE_ENV: "development",
      BETTER_AUTH_URL: "http://localhost:3000",
      BETTER_AUTH_SECRET: strongSecret,
    });

    expect(getLocalOAuthProxyOptions(production, { NODE_ENV: "production" })).toBeNull();
    expect(getLocalOAuthProxyOptions(loopback, { NODE_ENV: "development" })).toBeNull();
  });
});
