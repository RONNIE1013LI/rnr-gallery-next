// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFlikClient } from "./flik-client";
import { parseFlikConfig } from "./flik-config";
const config = parseFlikConfig({ ENABLE_FLIK_PAYMENTS: "true", FLIK_MODE: "test", VERCEL_ENV: "development", FLIK_CLIENT_ID: "flik_test_cid_fixture", FLIK_CLIENT_SECRET: "flik_test_sk_fixture", FLIK_WEBHOOK_SECRET: "whsec_fixture", DATABASE_URL: "postgresql://localhost/rnr_gallery_test_flik" });
if (!config.enabled) throw new Error("Invalid fixture");
const snapshot = { attemptId: "attempt-1", amountCents: 2501, currency: "NZD", testMode: true } as const;
const session = { id: "cs_fixture", status: "created", url: "https://app.flik.co.nz/checkout/s/opaque-token", amount: { total: 25.01, currency: "NZD" }, checkoutMethod: "open_banking", testMode: true, expiresAt: "2026-10-02T00:00:00Z" };
const retrieved = { ...session, status: "completed", foreignTransactionId: "attempt-1", transactionType: "open_banking" };
const token = { accessToken: "opaque-token", tokenType: "Bearer", expiresIn: "1h" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const input = { snapshot, reference: "RNR-TEST", redirectUrl: "https://example.test/api/payments/returns/flik", webhookUrl: "https://example.test/api/payments/webhooks/flik" };
afterEach(() => vi.useRealTimers());
describe("Flik API client", () => {
  it("does not call fetch after the shared worker deadline", async () => {
    const fetchImpl = vi.fn();
    const client = createFlikClient(config, { fetchImpl, now: () => 1000, deadlineMs: 1000 });
    await expect(client.createSession(input)).rejects.toMatchObject({ code: "request" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("rechecks the deadline after token authentication before creating payment", async () => {
    let now = 1000;
    const fetchImpl = vi.fn(async () => { now = 1100; return json(token); });
    const client = createFlikClient(config, { fetchImpl, now: () => now, deadlineMs: 1050 });
    await expect(client.createSession(input)).rejects.toMatchObject({ code: "request" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("cuts request timeout to the remaining deadline even if transport ignores abort", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {}));
    const client = createFlikClient(config, { fetchImpl, deadlineMs: 1050, timeoutMs: 10000 });
    const failed = expect(client.createSession(input)).rejects.toMatchObject({ code: "request" });
    await vi.advanceTimersByTimeAsync(50);
    await failed;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("includes response body reads in the shared deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const cancel = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const client = createFlikClient(config, { fetchImpl, deadlineMs: 1050 });
    const failed = expect(client.createSession(input)).rejects.toMatchObject({ code: "request" });
    await vi.advanceTimersByTimeAsync(50);
    await failed;
    expect(cancel).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("sends form credentials, major units, bank-only and stable attempt association; caches token", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json(session)).mockResolvedValueOnce(json(retrieved));
    const client = createFlikClient(config, { fetchImpl });
    await expect(client.createSession(input)).resolves.toMatchObject({ id: "cs_fixture", url: session.url, amountCents: 2501 });
    await expect(client.retrieveSession("cs_fixture", snapshot)).resolves.toMatchObject({ status: "completed", foreignTransactionId: "attempt-1" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const auth = fetchImpl.mock.calls[0][1];
    expect(auth.headers.Authorization).toBeUndefined();
    expect(new URLSearchParams(auth.body).get("clientId")).toBe(config.clientId);
    const create = fetchImpl.mock.calls[1][1];
    expect(JSON.parse(create.body)).toMatchObject({ type: "single", amount: { total: 25.01, currency: "NZD" }, checkoutMethod: "open_banking", foreignTransactionId: "attempt-1", webhookUrl: input.webhookUrl });
    expect(create.headers["Idempotency-Key"]).toBe("attempt-1");
    expect(create.redirect).toBe("error");
  });
  it("retrieves completed payments when Flik rejects a JSON content type on a bodyless GET", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") return json(token);
      return new Headers(init?.headers).has("Content-Type")
        ? json({ error: { code: "internal_server_error" } }, 500)
        : json(retrieved);
    });
    await expect(createFlikClient(config, { fetchImpl }).retrieveSession("cs_fixture", snapshot))
      .resolves.toMatchObject({ status: "completed", foreignTransactionId: "attempt-1" });
  });
  it.each([
    { id: "cs_other" }, { amount: { total: 25, currency: "NZD" } }, { amount: { total: 25.01, currency: "AUD" } },
    { foreignTransactionId: "other" }, { testMode: false }, { testMode: undefined },
    { checkoutMethod: "both" }, { transactionType: "card" }, { amount: { total: 25.011, currency: "NZD" } },
  ])("rejects payment response mismatch %o", async (change) => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json({ ...retrieved, ...change }));
    await expect(createFlikClient(config, { fetchImpl }).retrieveSession("cs_fixture", snapshot)).rejects.toMatchObject({ code: "response" });
  });
  it.each(["pending", "failed", "expired", "future-status"])("preserves %s for caller reconciliation without inventing success", async (status) => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json({ ...retrieved, status }));
    await expect(createFlikClient(config, { fetchImpl }).retrieveSession("cs_fixture", snapshot)).resolves.toMatchObject({ status });
  });
  it("refreshes once only on documented token_expired", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json({ error: { code: "token_expired" } }, 401)).mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json(session));
    await createFlikClient(config, { fetchImpl }).createSession(input);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl.mock.calls[1][1].body).toEqual(fetchImpl.mock.calls[3][1].body);
  });
  it.each([401, 500])("does not blindly retry create errors %s or expose provider text", async (status) => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json({ error: { code: "unknown_api_key", message: "private secret" } }, status));
    await expect(createFlikClient(config, { fetchImpl }).createSession(input)).rejects.toThrow("Flik request could not be confirmed");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("rejects unsafe redirect and webhook URLs before requesting", async () => {
    const fetchImpl = vi.fn();
    await expect(createFlikClient(config, { fetchImpl }).createSession({ ...input, webhookUrl: "http://example.test/hook" })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("rejects untrusted hosted payment destinations", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json({ ...session, url: "https://evil.test/checkout" }));
    await expect(createFlikClient(config, { fetchImpl }).createSession(input)).rejects.toThrow();
  });
  it("bounds transport timeout and hides transport details", async () => {
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("secret transport")))));
    await expect(createFlikClient(config, { fetchImpl, timeoutMs: 10 }).createSession(input)).rejects.toThrow("Flik request could not be confirmed");
  });
  it("does not retry an ambiguous create timeout", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(token)).mockRejectedValueOnce(new Error("private URL and token"));
    await expect(createFlikClient(config, { fetchImpl }).createSession(input)).rejects.toThrow("Flik request could not be confirmed");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("bounds response bodies", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json({ padding: "x".repeat(65536) }));
    await expect(createFlikClient(config, { fetchImpl }).createSession(input)).rejects.toMatchObject({ code: "response" });
  });
  it.each(["", "infinity", "-1h", "0s"])("rejects invalid token duration %s", async (expiresIn) => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ ...token, expiresIn }));
    await expect(createFlikClient(config, { fetchImpl }).createSession(input)).rejects.toMatchObject({ code: "response" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("shares only an in-flight token request for concurrent reads", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(token)).mockImplementation(() => Promise.resolve(json(retrieved)));
    const client = createFlikClient(config, { fetchImpl });
    await Promise.all([client.retrieveSession("cs_fixture", snapshot), client.retrieveSession("cs_fixture", snapshot)]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it("refreshes according to expiresIn rather than assuming one hour", async () => {
    let now = 0;
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ ...token, expiresIn: "2m" })).mockResolvedValueOnce(json(retrieved)).mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json(retrieved));
    const client = createFlikClient(config, { fetchImpl, now: () => now });
    await client.retrieveSession("cs_fixture", snapshot);
    now = 121_000;
    await client.retrieveSession("cs_fixture", snapshot);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});
