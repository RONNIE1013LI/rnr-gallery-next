import { describe, expect, it } from "vitest";

import { parseAuthConfig } from "./config";

const strongSecret = "test-only-auth-secret-32-characters";

describe("parseAuthConfig", () => {
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
});
