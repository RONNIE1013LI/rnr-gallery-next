// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHmac, randomUUID } from "node:crypto";
import { createQuoteRateLimit, productionQuoteRateLimit } from "./quote-rate-limit";

const redisEval = vi.hoisted(() => vi.fn().mockResolvedValue(1));
vi.mock("@upstash/redis", () => ({ Redis: vi.fn(function () { return { eval: redisEval }; }) }));

describe("quote request throttling", () => {
  it("uses an opaque network key and rejects requests beyond the allowance", async () => {
    const evalCommand = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const allow = createQuoteRateLimit({ redis: { eval: evalCommand }, namespace: "rnr:test", secret: "s".repeat(32), resolveIp: () => "203.0.113.4", now: () => new Date("2026-09-13T01:00:00Z") });
    const request = new Request("https://example.test/api/quote");
    expect(await allow(request, "12345678-1234-4234-8234-123456789abc")).toBe(true);
    expect(await allow(request, "12345678-1234-4234-8234-123456789abc")).toBe(false);
    expect(JSON.stringify(evalCommand.mock.calls)).not.toContain("203.0.113.4");
    expect(evalCommand.mock.calls[0][1][0]).toMatch(/^rnr:test:quote-rate:[a-f0-9]{64}:\d+$/);
  });
  it("fails closed when the shared throttling store is unavailable", async () => {
    const allow = createQuoteRateLimit({ redis: { eval: async () => { throw new Error("offline"); } }, namespace: "rnr:test", secret: "s".repeat(32), resolveIp: () => "203.0.113.4" });
    await expect(allow(new Request("https://example.test/api/quote"), "12345678-1234-4234-8234-123456789abc")).rejects.toThrow();
  });
});

// Opt in to real Lua execution; this suite never reads production Redis settings.
// RNR_QUOTE_LOCAL_REDIS_TEST=1 npx vitest run src/server/enquiry/quote-rate-limit.test.ts
const runFile = promisify(execFile);
describe.runIf(process.env.RNR_QUOTE_LOCAL_REDIS_TEST === "1")("quote throttling against disposable local Redis", () => {
  const containerName = `rnr-quote-limit-test-${randomUUID()}`;
  let containerId: string | undefined;
  async function redisCommand(...args: string[]) {
    const { stdout } = await runFile("docker", ["exec", containerId!, "redis-cli", "--raw", ...args]);
    return stdout.trim();
  }
  beforeAll(async () => {
    const { stdout } = await runFile("docker", ["run", "--rm", "-d", "--name", containerName,
      "--network", "none", "--read-only", "--tmpfs", "/data:rw,nosuid,noexec,size=16m",
      "redis:7-alpine", "redis-server", "--save", "", "--appendonly", "no", "--bind", "127.0.0.1"]);
    containerId = stdout.trim();
    expect(containerId).toMatch(/^[a-f0-9]{64}$/);
    const { stdout: inspected } = await runFile("docker", ["inspect", containerId]);
    const inspection = JSON.parse(inspected)[0];
    expect(inspection.HostConfig.NetworkMode).toBe("none");
    expect(inspection.Mounts.every((mount: { Type: string }) => mount.Type === "tmpfs")).toBe(true);
    expect(await redisCommand("PING")).toBe("PONG");
  }, 30000);
  afterAll(async () => {
    if (containerId) await runFile("docker", ["rm", "-f", containerId]);
  });
  function limiter(clock = { value: new Date("2026-09-13T01:00:00Z") }, ip = "203.0.113.4") {
    const commands: { keys: string[] }[] = [];
    const allow = createQuoteRateLimit({ namespace: `test:${randomUUID()}`, secret: "s".repeat(32), resolveIp: () => ip, now: () => clock.value,
      redis: { eval: async (script, keys, args) => {
        commands.push({ keys });
        return Number(await redisCommand("EVAL", script, String(keys.length), ...keys, ...args));
      } } });
    return { allow: (id: string) => allow(new Request("https://example.test/api/quote"), id), commands };
  }
  it("permits bounded idempotent retries but rejects the sixteenth network attempt", async () => {
    const { allow } = limiter();
    for (let attempt = 0; attempt < 15; attempt++) expect(await allow("same-enquiry")).toBe(true);
    expect(await allow("same-enquiry")).toBe(false);
    expect(await allow("different-enquiry")).toBe(false);
  }, 30000);
  it("retains five distinct enquiries and charges rejected new requests against the attempt cap", async () => {
    const { allow } = limiter();
    for (let enquiry = 0; enquiry < 5; enquiry++) expect(await allow(`enquiry-${enquiry}`)).toBe(true);
    for (let rejected = 0; rejected < 9; rejected++) expect(await allow(`rejected-${rejected}`)).toBe(false);
    expect(await allow("enquiry-0")).toBe(true);
    expect(await allow("enquiry-0")).toBe(false);
  }, 30000);
  it("does not count retries as distinct enquiries and expires all opaque limiter keys", async () => {
    const { allow, commands } = limiter();
    for (let retry = 0; retry < 11; retry++) expect(await allow("first-enquiry")).toBe(true);
    for (let enquiry = 1; enquiry < 5; enquiry++) expect(await allow(`enquiry-${enquiry}`)).toBe(true);
    expect(await allow("first-enquiry")).toBe(false);
    for (const key of new Set(commands.flatMap((command) => command.keys))) {
      const ttl = Number(await redisCommand("TTL", key));
      expect(ttl).toBeGreaterThan(0); expect(ttl).toBeLessThanOrEqual(3700);
    }
  }, 30000);
  it("resets the fixed-hour allowance without removing old keys", async () => {
    const clock = { value: new Date("2026-09-13T01:00:00Z") };
    const { allow } = limiter(clock);
    for (let attempt = 0; attempt < 15; attempt++) expect(await allow("same-enquiry")).toBe(true);
    expect(await allow("same-enquiry")).toBe(false);
    clock.value = new Date("2026-09-13T02:00:00Z");
    expect(await allow("same-enquiry")).toBe(true);
  }, 30000);
  it("atomically enforces fifteen attempts when twenty retries arrive concurrently", async () => {
    const { allow } = limiter();
    const results = await Promise.all(Array.from({ length: 20 }, () => allow("concurrent-enquiry")));
    expect(results.filter(Boolean)).toHaveLength(15);
    expect(results.filter((result) => !result)).toHaveLength(5);
  }, 30000);
});

describe("production quote limiter secret configuration", () => {
  const base = { RNR_AI_REDIS_REST_URL: "https://redis.invalid", RNR_AI_REDIS_REST_TOKEN: "synthetic-token", RNR_AI_REDIS_NAMESPACE: "rnr:test" };
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); redisEval.mockClear(); });
  async function networkKey(env: Record<string, string>) {
    vi.stubEnv("VERCEL", "1");
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-13T01:00:00Z"));
    const allow = productionQuoteRateLimit({ ...base, ...env });
    await allow(new Request("https://example.test/api/quote", { headers: { "x-vercel-forwarded-for": "203.0.113.4" } }), "synthetic-enquiry");
    return redisEval.mock.calls.at(-1)![1][0] as string;
  }
  it("derives a quote-specific fallback from a sufficiently long existing auth secret", async () => {
    const authSecret = "synthetic-auth-secret-".repeat(3);
    const derived = createHmac("sha256", authSecret).update("rnr-quote-rate-limit-v1").digest("hex");
    const fallbackKey = await networkKey({ BETTER_AUTH_SECRET: authSecret });
    expect(fallbackKey).toBe(await networkKey({ CUSTOMER_CHAT_ABUSE_HASH_SECRET: derived }));
    expect(fallbackKey).not.toBe(await networkKey({ CUSTOMER_CHAT_ABUSE_HASH_SECRET: authSecret }));
  });
  it("preserves the explicit abuse secret in preference to the fallback", async () => {
    const explicit = "synthetic-abuse-secret-".repeat(3);
    expect(await networkKey({ CUSTOMER_CHAT_ABUSE_HASH_SECRET: explicit, BETTER_AUTH_SECRET: "different-auth-secret-".repeat(3) }))
      .toBe(await networkKey({ CUSTOMER_CHAT_ABUSE_HASH_SECRET: explicit }));
  });
  it.each([{}, { BETTER_AUTH_SECRET: "short" }, { CUSTOMER_CHAT_ABUSE_HASH_SECRET: "short", BETTER_AUTH_SECRET: "valid-auth-secret-".repeat(3) }])("fails closed with missing or insufficient secret material (case %#)", (env) => {
    expect(() => productionQuoteRateLimit({ ...base, ...env })).toThrow("quote_rate_limit_unavailable");
  });
});
