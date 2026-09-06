// @vitest-environment node
import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import { betterAuth } from "better-auth";
import { memoryAdapter, type MemoryDB } from "better-auth/adapters/memory";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebsiteChatAuthCandidate } from "@/server/rnr-ai/website/chat-auth";
import { RedisWebsiteRepository } from "@/server/rnr-ai/website/redis-website-repository";
import { POST as bootstrap } from "./session/route";
import { POST as send } from "./messages/route";
import { GET as updates } from "./updates/route";

vi.mock("@/server/customer-service/runtime", () => { throw Error("DB TRAP: legacy runtime"); });
vi.mock("@/server/db/client", () => { throw Error("DB TRAP: database client"); });
vi.mock("@/server/db/schema", () => { throw Error("DB TRAP: database schema"); });
const scheduled = vi.hoisted(() => ({ tasks: [] as (() => Promise<void>)[] }));
vi.mock("next/server", () => ({ after: (task: () => Promise<void>) => scheduled.tasks.push(task) }));
const url = process.env.WEBSITE_TEST_REDIS_URL;
const origin = "http://localhost:3000";
const secret = "synthetic-auth-secret-0123456789-ABCdef";
const encryptionKey = "synthetic-encryption-key-0123456789";
function request(path: string, body?: unknown, cookie = "", permit?: string) {
  return new Request(`${origin}/api/customer-chat/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { origin, "content-type": "application/json", "sec-fetch-site": "same-origin", "x-vercel-forwarded-for": "127.0.0.1", cookie, ...(permit ? { "x-rnr-customer-chat-permit": permit } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function message(key: string) { return { clientMessageKey: key, message: "What sizes are available?", pageContext: { pathname: "/products/photo-print-canvas", market: "NZ" } }; }
async function start(authCookie = "") {
  const key = randomUUID();
  const result = await bootstrap(request("session", { version: 1, clientMessageKey: key }, authCookie));
  expect(result.status).toBe(200);
  const cookie = [authCookie, result.headers.get("set-cookie")?.split(";")[0]].filter(Boolean).join("; ");
  const { permit } = await result.json();
  return { key, cookie, permit };
}

describe.runIf(Boolean(url))("actual Redis public route composition", () => {
  beforeEach(() => {
    if (!url || !/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) throw Error("loopback Redis required");
    const env = {
      WEBSITE_CUSTOMER_ASSISTANT_ENABLED: "true", REPLY_ASSISTANT_ENABLED: "false", AI_PROVIDER: "mock",
      RNR_WEBSITE_SHARED_BRAIN_ENABLED: "true", RNR_AI_MASTER_ENABLED: "false", REPLY_ASSISTANT_DEBOUNCE_MS: "250",
      CUSTOMER_CHAT_SESSION_SECRET: "s".repeat(40), CUSTOMER_CHAT_ABUSE_HASH_SECRET: "a".repeat(40),
      REPLY_ASSISTANT_REVIEW_LINK_SECRET: "r".repeat(40), CRON_SECRET: "c".repeat(40), REPLY_ASSISTANT_ALERT_TO: "synthetic@example.test",
      BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: origin, RNR_AI_REDIS_REST_URL: url,
      RNR_AI_REDIS_REST_TOKEN: "synthetic-local-redis-test", RNR_AI_REDIS_NAMESPACE: `route-test-${randomUUID()}`,
      RNR_AI_REVIEW_ENCRYPTION_KEY: encryptionKey, RESEND_API_KEY: "", EMAIL_FROM: "", VERCEL_ENV: "", VERCEL: "1",
    };
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    scheduled.tasks.length = 0;
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it.each(["master OFF", "shared control OFF"])("bootstraps/sends/polls, deduplicates and exposes manual staff replies with %s and database traps", async (gate) => {
    vi.stubEnv("RNR_AI_MASTER_ENABLED", gate === "master OFF" ? "false" : "true");
    const redis = new Redis({ url: url!, token: "synthetic-local-redis-test", responseEncoding: false });
    await redis.set(`${process.env.RNR_AI_REDIS_NAMESPACE}:control`, {
      revision: 1, mode: gate === "master OFF" ? "ON" : "OFF", timezone: "Pacific/Auckland", periods: [], override: null,
    });
    const nativeFetch = globalThis.fetch;
    const provider = vi.fn();
    vi.stubGlobal("fetch", (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (input === "https://api.openai.com/v1/responses") { provider(); throw Error("paid provider must not run while OFF"); }
      if (!String(input).startsWith(url!)) throw Error("unexpected external transport");
      return nativeFetch(input, init);
    });
    const chat = await start();
    expect((await send(request("messages", message(chat.key), chat.cookie, chat.permit))).status).toBe(202);
    expect((await send(request("messages", message(chat.key), chat.cookie, chat.permit))).status).toBe(202);
    expect(scheduled.tasks).toHaveLength(1);
    await scheduled.tasks[0]();
    const first = await (await updates(request("updates", undefined, chat.cookie))).json();
    expect(first.events.filter((event: { role: string }) => event.role === "customer")).toHaveLength(1);
    expect(first.events[0].role).toBe("customer");
    const repository = RedisWebsiteRepository.fromEnvironment();
    expect(provider).not.toHaveBeenCalled();
    expect(await repository.pendingTurnIds(5)).toEqual([]);
    const item = (await repository.listQueue(5)).items[0];
    expect(item.websiteReview?.selector).toBeTruthy();
    const answered = await repository.answerWebsiteReview({ reviewSelector: item.websiteReview!.selector!, actorUserId: "synthetic-staff", text: "We can help you choose a size.", now: new Date() });
    expect(answered.status).toBe("sent");
    const next = await (await updates(request(`updates?cursor=${encodeURIComponent(first.cursor)}`, undefined, chat.cookie))).json();
    expect(next.events.some((event: { role: string; text: string }) => event.role === "staff" && event.text === "We can help you choose a size.")).toBe(true);
  });

  it("runs the actual shared brain and publishes its verified response without a database dependency", async () => {
    vi.stubEnv("RNR_AI_MASTER_ENABLED", "true");
    vi.stubEnv("OPENAI_API_KEY", "synthetic-provider-test-key");
    const redis = new Redis({ url: url!, token: "synthetic-local-redis-test", responseEncoding: false });
    await redis.set(`${process.env.RNR_AI_REDIS_NAMESPACE}:control`, {
      revision: 1, mode: "ON", timezone: "Pacific/Auckland", periods: [], override: null,
    });
    await redis.set(`${process.env.RNR_AI_REDIS_NAMESPACE}:control:website`, {
      revision: 1, mode: "ON", timezone: "Pacific/Auckland", periods: [], override: null,
    });
    await redis.set(`${process.env.RNR_AI_REDIS_NAMESPACE}:control`, {
      revision: 2, mode: "OFF", timezone: "Pacific/Auckland", periods: [], override: null,
    });
    const nativeFetch = globalThis.fetch;
    const candidate = { mode: "ANSWER", reply: "Hello! How can we help?", market: "UNKNOWN", marketEvidenceTurn: null };
    const outputs = [{ ...candidate, requestedTools: [] }, {
      mode: candidate.mode, market: candidate.market, marketEvidenceTurn: null, openIssue: "NONE", relevantCustomerTurnIds: ["t1"],
      claims: [], safe: true, helpful: true, clarificationOnly: false, customerInputRequest: null,
      internalErrorLanguage: false, unnecessaryQuestion: false, issues: [],
    }];
    let attempt = 0;
    const provider = vi.fn(async () => new Response(JSON.stringify({
      model: "gpt-5.6-luna", output_text: JSON.stringify(outputs[attempt++] ?? outputs[1]),
      usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 0 } },
    }), { status: 200 }));
    vi.stubGlobal("fetch", (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (input === "https://api.openai.com/v1/responses") return provider();
      if (!String(input).startsWith(url!)) throw Error("unexpected external transport");
      return nativeFetch(input, init);
    });
    const chat = await start();
    expect((await send(request("messages", { ...message(chat.key), message: "Hello" }, chat.cookie, chat.permit))).status).toBe(202);
    await scheduled.tasks[0]();
    expect(provider).toHaveBeenCalled();
    const result = await (await updates(request("updates", undefined, chat.cookie))).json();
    expect(result.events.some((event: { role: string; text: string }) => event.role === "assistant" && event.text === "Hello! How can we help?")).toBe(true);
  });

  it("uses native login cache, isolates login/logout identities and fails closed for missing signed sessions", async () => {
    const redis = new Redis({ url: url!, token: "synthetic-local-redis-test", automaticDeserialization: false, responseEncoding: false });
    const db: MemoryDB = { user: [], session: [], account: [], verification: [] };
    const nativeSessions = {
      async list(userId: string) { return db.session.filter((row) => row.userId === userId).map((row) => ({ token: String(row.token), expiresAt: row.expiresAt as Date })); },
      async get(token: string) {
        const session = db.session.find((row) => row.token === token);
        const user = session && db.user.find((row) => row.id === session.userId);
        return session && user ? { session: session as { token: string; userId: string; createdAt: Date; expiresAt: Date }, user: user as { id: string } } : null;
      },
    };
    const candidate = createWebsiteChatAuthCandidate({ nativeSessions, redis, namespace: process.env.RNR_AI_REDIS_NAMESPACE!, encryptionKey, secret, baseURL: origin });
    const auth = betterAuth({ baseURL: origin, secret, database: memoryAdapter(db), emailAndPassword: { enabled: true }, ...candidate.authOptions });
    const login = await auth.api.signUpEmail({ body: { email: "synthetic@example.test", password: "Synthetic-password-123", name: "Synthetic" }, asResponse: true });
    expect(login.status).toBe(200);
    const authCookie = login.headers.getSetCookie().find((value) => value.startsWith("better-auth.session_token="))!.split(";")[0];
    const anon = await start();
    expect((await send(request("messages", message(anon.key), anon.cookie, anon.permit))).status).toBe(202);
    expect((await (await updates(request("updates", undefined, `${anon.cookie}; ${authCookie}`))).json()).events).toEqual([]);
    const chat = await start(authCookie);
    expect((await send(request("messages", message(chat.key), chat.cookie, chat.permit))).status).toBe(202);
    expect((await (await updates(request("updates", undefined, chat.cookie))).json()).events).toHaveLength(1);
    const onlyChatCookie = chat.cookie.split("; ").filter((part) => part.startsWith("rnr_customer_chat=")).join("; ");
    expect((await (await updates(request("updates", undefined, onlyChatCookie))).json()).events).toEqual([]);
    await auth.api.signOut({ headers: new Headers({ cookie: authCookie }) });
    for (const response of [await bootstrap(request("session", { version: 1, clientMessageKey: randomUUID() }, authCookie)), await send(request("messages", message(chat.key), chat.cookie, chat.permit)), await updates(request("updates", undefined, chat.cookie)), await updates(request("updates", undefined, authCookie))]) {
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: { code: "WEBSITE_CHAT_IDENTITY_UNAVAILABLE" } });
    }
  });
});
