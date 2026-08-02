import { describe, expect, it, vi } from "vitest";
import { createProviderHttp, ProviderHttpError } from "./provider-http";

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

describe("provider HTTP boundary", () => {
  it("uses an HTTPS base URL, Basic auth, JSON headers and a caller-owned schema", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const http = createProviderHttp({
      baseUrl: "https://global-api-sandbox.afterpay.com",
      username: "merchant-id",
      password: "server-secret",
      userAgent: "merchant-id",
      fetchImpl,
    });

    await expect(http.json({
      method: "POST",
      path: "/v2/checkouts",
      body: { amount: "120.75" },
      validate: (value): value is { ok: true } =>
        typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === true,
    })).resolves.toEqual({ ok: true });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://global-api-sandbox.afterpay.com/v2/checkouts",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ amount: "120.75" }),
        headers: {
          Accept: "application/json",
          Authorization: `Basic ${Buffer.from("merchant-id:server-secret").toString("base64")}`,
          "Content-Type": "application/json",
          "User-Agent": "merchant-id",
        },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each([
    "http://global-api-sandbox.afterpay.com",
    "https://user:password@global-api-sandbox.afterpay.com",
    "https://global-api-sandbox.afterpay.com/v2",
    "https://global-api-sandbox.afterpay.com?unsafe=true",
  ])("rejects an unsafe configured base URL: %s", (baseUrl) => {
    expect(() => createProviderHttp({
      baseUrl,
      username: "merchant-id",
      password: "server-secret",
      userAgent: "merchant-id",
      fetchImpl: vi.fn(),
    })).toThrow("Payment provider configuration is invalid");
  });

  it("rejects paths that can escape the configured origin", async () => {
    const http = createProviderHttp({
      baseUrl: "https://global-api-sandbox.afterpay.com",
      username: "merchant-id",
      password: "server-secret",
      userAgent: "merchant-id",
      fetchImpl: vi.fn(),
    });

    await expect(http.json({
      method: "GET",
      path: "//evil.example.test/steal",
      validate: (value): value is object => typeof value === "object" && value !== null,
    })).rejects.toMatchObject({ name: "ProviderHttpError", code: "request" });
  });

  it("aborts at the configured timeout and exposes no transport detail", async () => {
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("server-secret timeout response body")),
        );
      }));
    const http = createProviderHttp({
      baseUrl: "https://global-api-sandbox.afterpay.com",
      username: "merchant-id",
      password: "server-secret",
      userAgent: "merchant-id",
      timeoutMs: 1,
      fetchImpl,
    });

    const error = await http.json({
      method: "GET",
      path: "/v2/configuration",
      validate: (value): value is object => typeof value === "object" && value !== null,
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(ProviderHttpError);
    expect(error).toMatchObject({ code: "request", message: "Payment provider request failed" });
    expect(String(error)).not.toMatch(/server-secret|response body/);
  });

  it.each([
    ["non-success", new Response("server-secret", { status: 401, headers: { "Content-Type": "application/json" } })],
    ["wrong content type", new Response("{}", { status: 200, headers: { "Content-Type": "text/html" } })],
    ["invalid JSON", new Response("{not-json", { status: 200, headers: { "Content-Type": "application/json" } })],
    ["invalid schema", jsonResponse({ unsafe: "server-secret" })],
    ["oversized declared response", jsonResponse({ ok: true }, 200, { "Content-Length": "5000" })],
  ])("rejects a %s response without exposing its body", async (_name, response) => {
    const http = createProviderHttp({
      baseUrl: "https://global-api-sandbox.afterpay.com",
      username: "merchant-id",
      password: "server-secret",
      userAgent: "merchant-id",
      maxResponseBytes: 100,
      fetchImpl: vi.fn().mockResolvedValue(response),
    });

    const error = await http.json({
      method: "GET",
      path: "/v2/configuration",
      validate: (value): value is { ok: true } =>
        typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === true,
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(ProviderHttpError);
    expect(String(error)).not.toContain("server-secret");
  });

  it("stops reading a response once the actual body exceeds the limit", async () => {
    const http = createProviderHttp({
      baseUrl: "https://global-api-sandbox.afterpay.com",
      username: "merchant-id",
      password: "server-secret",
      userAgent: "merchant-id",
      maxResponseBytes: 32,
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ value: "x".repeat(100) })),
    });

    await expect(http.json({
      method: "GET",
      path: "/v2/configuration",
      validate: (value): value is object => typeof value === "object" && value !== null,
    })).rejects.toMatchObject({
      name: "ProviderHttpError",
      code: "response",
      message: "Payment provider response invalid",
    });
  });
});
