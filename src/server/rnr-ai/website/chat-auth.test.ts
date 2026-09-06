// @vitest-environment node
import { describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { getCookies } from "better-auth/cookies";
import { Redis } from "@upstash/redis";
import {
  createWebsiteChatAuthCandidate,
  getWebsiteChatIdentitySession,
  WebsiteChatIdentityUnavailableError,
} from "./chat-auth";

const secret = "test-only-Authentication-Secret-0123456789";
const baseURL = "https://chat-auth.example.test";

function localRedis() {
  const url = process.env.RNR_CHAT_AUTH_TEST_REDIS_URL;
  if (!url || new URL(url).hostname !== "127.0.0.1") throw new Error("Only loopback Redis is allowed");
  return new Redis({ url, token: "synthetic-local-redis-test", responseEncoding: false, automaticDeserialization: false });
}
const storageModes = ["memory", ...(process.env.RNR_CHAT_AUTH_TEST_REDIS_URL ? ["redis"] : [])];

function fixture(redisOverride?: Redis) {
  const values = new Map<string, string>();
  let clockOffset = 0;
  let offline = false;
  let resetToken = "";
  const redis = {
    async get(key: string) { if (offline) throw new Error("offline"); return values.get(key) ?? null; },
    async set(key: string, value: string) { if (offline) throw new Error("offline"); values.set(key, value); return "OK"; },
    async del(key: string) { if (offline) throw new Error("offline"); return Number(values.delete(key)); },
    async eval(script: string, keys: string[], args: string[]) {
      if (offline) throw new Error("offline");
      if (script.includes("EXISTS")) {
        if (values.has(keys[1])) return 0;
        values.set(keys[0], args[0]);
        return 1;
      }
      if (script.includes("math.max")) {
        values.set(keys[1], String(Math.max(Number(values.get(keys[1]) ?? 0), Number(args[0]))));
        return Number(values.delete(keys[0]));
      }
      values.set(keys[1], "1");
      return Number(values.delete(keys[0]));
    },
  };
  const candidate = createWebsiteChatAuthCandidate({ redis: redisOverride ?? redis, namespace: `test:auth:${crypto.randomUUID()}`, encryptionKey: "test-only-encryption-key-0123456789", secret, baseURL, now: () => Date.now() + clockOffset });
  const db = { user: [], session: [], account: [], verification: [] };
  const auth = betterAuth({ baseURL, secret, database: memoryAdapter(db), emailAndPassword: { enabled: true, revokeSessionsOnPasswordReset: true, sendResetPassword: async ({ token }) => { resetToken = token; } }, ...candidate.authOptions });
  async function signup(email = "person@example.test") {
    const response = await auth.api.signUpEmail({ body: { email, password: "test-Password-1234", name: "Test" }, asResponse: true });
    expect(response.status).toBe(200);
    const name = getCookies({ baseURL }).sessionToken.name;
    const cookie = response.headers.getSetCookie().find((line) => line.startsWith(`${name}=`))!.split(";")[0];
    const user = (await response.json()).user;
    return { headers: new Headers({ cookie, origin: baseURL }), user, cookie };
  }
  return { ...candidate, auth, db, signup, values, resetToken: () => resetToken, offline: () => { offline = true; }, advance: () => { clockOffset += 8 * 86400_000; } };
}

describe("inactive website chat auth candidate", () => {
  it("uses a real Better Auth signed login with encrypted token/user storage and no database reads for chat", async () => {
    const f = fixture();
    const login = await f.signup();
    expect(f.db.session).toHaveLength(1);
    const stored = JSON.stringify([...f.values]);
    expect(stored).not.toContain(login.user.id);
    expect(stored).not.toContain("person@example.test");
    expect(stored).not.toContain(decodeURIComponent(login.cookie.split("=").slice(1).join("=")).split(".")[0]);
    Object.defineProperty(f.db, "session", { get() { throw new Error("DB TRAP"); } });
    Object.defineProperty(f.db, "user", { get() { throw new Error("DB TRAP"); } });
    expect(await f.getIdentitySession(login.headers)).toEqual({ user: { id: login.user.id } });
    expect(await f.getIdentitySession(new Headers())).toBeNull();
  });

  it("fails closed for cold, expired, tampered, duplicate and unavailable signed sessions", async () => {
    const f = fixture();
    const login = await f.signup();
    const tampered = new Headers({ cookie: login.cookie.slice(0, -4) + "AAAA" });
    await expect(f.getIdentitySession(tampered)).rejects.toBeInstanceOf(WebsiteChatIdentityUnavailableError);
    await expect(f.getIdentitySession(new Headers({ cookie: `${login.cookie}; ${login.cookie}` }))).rejects.toBeInstanceOf(WebsiteChatIdentityUnavailableError);
    await expect(f.getIdentitySession(new Headers({ cookie: login.cookie.replace("=", " =") }))).rejects.toBeInstanceOf(WebsiteChatIdentityUnavailableError);
    await expect(getWebsiteChatIdentitySession(new Headers({ cookie: "__Secure-better-auth.session_token =invalid" }))).rejects.toBeInstanceOf(WebsiteChatIdentityUnavailableError);
    f.advance();
    await expect(f.getIdentitySession(login.headers)).rejects.toBeInstanceOf(WebsiteChatIdentityUnavailableError);
    f.values.clear();
    await expect(f.getIdentitySession(login.headers)).rejects.toBeInstanceOf(WebsiteChatIdentityUnavailableError);
    expect(f.db.session).toHaveLength(1);
    f.offline();
    await expect(f.getIdentitySession(login.headers)).rejects.toBeInstanceOf(WebsiteChatIdentityUnavailableError);
    expect(await f.getIdentitySession(new Headers())).toBeNull();
  });

  it("revokes the real signed cookie at logout and isolates a new login", async () => {
    const f = fixture();
    const a = await f.signup();
    const b = await f.signup("second@example.test");
    expect(await f.getIdentitySession(b.headers)).toEqual({ user: { id: b.user.id } });
    await f.auth.api.signOut({ headers: a.headers });
    await expect(f.getIdentitySession(a.headers)).rejects.toBeInstanceOf(WebsiteChatIdentityUnavailableError);
    expect(await f.getIdentitySession(b.headers)).toEqual({ user: { id: b.user.id } });
    expect(f.db.session).toHaveLength(1);
  });

  it("revokes all real native sessions for one user and preserves another user", async () => {
    const f = fixture();
    const a = await f.signup();
    const other = await f.signup("other@example.test");
    const response = await f.auth.api.signInEmail({ body: { email: "person@example.test", password: "test-Password-1234" }, asResponse: true });
    const name = getCookies({ baseURL }).sessionToken.name;
    const cookie = response.headers.getSetCookie().find((line) => line.startsWith(`${name}=`))!.split(";")[0];
    const second = new Headers({ cookie, origin: baseURL });
    expect(await f.getIdentitySession(second)).toEqual({ user: { id: a.user.id } });
    await f.auth.api.revokeSessions({ headers: a.headers });
    await expect(f.getIdentitySession(a.headers)).rejects.toBeInstanceOf(WebsiteChatIdentityUnavailableError);
    await expect(f.getIdentitySession(second)).rejects.toBeInstanceOf(WebsiteChatIdentityUnavailableError);
    expect(await f.getIdentitySession(other.headers)).toEqual({ user: { id: other.user.id } });
    expect(f.db.session).toHaveLength(1);
  });

  it("password reset revokes existing native sessions and permits a fresh login", async () => {
    const f = fixture();
    const a = await f.signup();
    await f.auth.api.requestPasswordReset({ body: { email: "person@example.test", redirectTo: baseURL } });
    expect(f.resetToken()).not.toBe("");
    expect(f.db.verification).toHaveLength(1);
    await f.auth.api.resetPassword({ body: { token: f.resetToken(), newPassword: "changed-Password-1234" } });
    expect(f.db.verification).toHaveLength(0);
    expect(f.db.session).toHaveLength(0);
    await expect(f.getIdentitySession(a.headers)).rejects.toBeInstanceOf(WebsiteChatIdentityUnavailableError);
    const response = await f.auth.api.signInEmail({ body: { email: "person@example.test", password: "changed-Password-1234" }, asResponse: true });
    expect(response.status).toBe(200);
    const name = getCookies({ baseURL }).sessionToken.name;
    const cookie = response.headers.getSetCookie().find((line) => line.startsWith(`${name}=`))!.split(";")[0];
    expect(await f.getIdentitySession(new Headers({ cookie }))).toEqual({ user: { id: a.user.id } });
  });

  it("rejects ciphertext substitution between cache keys", async () => {
    const f = fixture();
    const a = await f.signup();
    await f.signup("second@example.test");
    const pairs = [...f.values];
    for (let i = 0; i < pairs.length; i++) f.values.set(pairs[i][0], pairs[(i + 1) % pairs.length][1]);
    await expect(f.getIdentitySession(a.headers)).rejects.toBeInstanceOf(WebsiteChatIdentityUnavailableError);
  });
});

// Opt-in only: isolated loopback Redis bridge; never load production Redis env.
it.runIf(Boolean(process.env.RNR_CHAT_AUTH_TEST_REDIS_URL))("real isolated Redis: native create, refresh, revoke and database preservation", async () => {
  const url = process.env.RNR_CHAT_AUTH_TEST_REDIS_URL!;
  if (new URL(url).hostname !== "127.0.0.1") throw new Error("Only loopback Redis is allowed");
  const redis = new Redis({ url, token: "synthetic-local-redis-test", responseEncoding: false, automaticDeserialization: false });
  const candidate = createWebsiteChatAuthCandidate({ redis, namespace: `auth-test:${crypto.randomUUID()}`, encryptionKey: "test-only-encryption-key-0123456789", secret, baseURL });
  const db = { user: [], session: [], account: [], verification: [] };
  const auth = betterAuth({ baseURL, secret, database: memoryAdapter(db), emailAndPassword: { enabled: true }, ...candidate.authOptions });
  const response = await auth.api.signUpEmail({ body: { email: "redis@example.test", password: "test-Password-1234", name: "Synthetic" }, asResponse: true });
  expect(response.status).toBe(200);
  const user = (await response.json()).user;
  const name = getCookies({ baseURL }).sessionToken.name;
  const cookie = response.headers.getSetCookie().find((line) => line.startsWith(`${name}=`))!.split(";")[0];
  const headers = new Headers({ cookie, origin: baseURL });
  expect(await candidate.getIdentitySession(headers)).toEqual({ user: { id: user.id } });
  expect(db.session).toHaveLength(1);
  const ctx = await auth.$context;
  const session = await auth.api.getSession({ headers });
  await ctx.internalAdapter.updateSession(session!.session.token, { expiresAt: new Date(Date.now() + 60_000) });
  expect(await candidate.getIdentitySession(headers)).toEqual({ user: { id: user.id } });
  await ctx.internalAdapter.createVerificationValue({ identifier: "synthetic-verification", value: "synthetic-value", expiresAt: new Date(Date.now() + 60_000) });
  expect(db.verification).toHaveLength(1);
  await ctx.internalAdapter.deleteVerificationByIdentifier("synthetic-verification");
  expect(db.verification).toHaveLength(0);
  await auth.api.signOut({ headers });
  expect(db.session).toHaveLength(0);
  await expect(candidate.getIdentitySession(headers)).rejects.toBeInstanceOf(WebsiteChatIdentityUnavailableError);
});

it.each(storageModes.flatMap((mode) => [ [mode, "revoke-all"], [mode, "password-reset"] ]))("%s: native concurrent login followed by %s must invalidate every signed cookie", async (mode, operation) => {
  const f = fixture(mode === "redis" ? localRedis() : undefined);
  const a = await f.signup();
  const storage = f.authOptions.secondaryStorage;
  const originalGet = storage.get.bind(storage);
  let arrivals = 0;
  let release!: () => void;
  const bothRead = new Promise<void>((resolve) => { release = resolve; });
  storage.get = async (key) => {
    const result = await originalGet(key);
    if (key === `active-sessions-${a.user.id}` && arrivals < 2) {
      arrivals += 1;
      if (arrivals === 2) release();
      await bothRead;
    }
    return result;
  };
  const logins = await Promise.all([1, 2].map(async () => {
    const response = await f.auth.api.signInEmail({ body: { email: "person@example.test", password: "test-Password-1234" }, asResponse: true });
    expect(response.status).toBe(200);
    const name = getCookies({ baseURL }).sessionToken.name;
    const cookie = response.headers.getSetCookie().find((line) => line.startsWith(`${name}=`))!.split(";")[0];
    return new Headers({ cookie, origin: baseURL });
  }));
  if (operation === "password-reset") {
    await f.auth.api.requestPasswordReset({ body: { email: "person@example.test", redirectTo: baseURL } });
    await f.auth.api.resetPassword({ body: { token: f.resetToken(), newPassword: "changed-Password-1234" } });
  } else {
    await f.auth.api.revokeSessions({ headers: a.headers });
  }
  expect(f.db.session).toHaveLength(0);
  for (const headers of logins) {
    await expect(f.getIdentitySession(headers)).rejects.toBeInstanceOf(WebsiteChatIdentityUnavailableError);
    expect(await f.auth.api.getSession({ headers })).toBeNull();
  }
});

it.each(storageModes)("%s: a paused native cache refresh cannot resurrect a revoked session", async (mode) => {
  const f = fixture(mode === "redis" ? localRedis() : undefined);
  const a = await f.signup();
  const current = await f.auth.api.getSession({ headers: a.headers });
  const token = current!.session.token;
  const originalSet = f.authOptions.secondaryStorage.set.bind(f.authOptions.secondaryStorage);
  let reached!: () => void;
  let resume!: () => void;
  const paused = new Promise<void>((resolve) => { reached = resolve; });
  const resumed = new Promise<void>((resolve) => { resume = resolve; });
  f.authOptions.secondaryStorage.set = async (key, value, ttl) => {
    if (key === token) { reached(); await resumed; }
    return originalSet(key, value, ttl);
  };
  const context = await f.auth.$context;
  const refresh = context.internalAdapter.updateSession(token, { expiresAt: new Date(Date.now() + 86400_000) });
  await paused;
  await f.auth.api.signOut({ headers: a.headers });
  resume();
  await refresh;
  expect(f.db.session).toHaveLength(0);
  expect(await f.authOptions.secondaryStorage.get(token)).toBeNull();
  await expect(f.getIdentitySession(a.headers)).rejects.toBeInstanceOf(WebsiteChatIdentityUnavailableError);
});

it.each(storageModes)("%s: bulk revocation covers an index-orphan beyond the native 100-row hook limit", async (mode) => {
  const f = fixture(mode === "redis" ? localRedis() : undefined);
  const a = await f.signup();
  const context = await f.auth.$context;
  for (let i = 0; i < 100; i++) await context.internalAdapter.createSession(a.user.id);
  const response = await f.auth.api.signInEmail({ body: { email: "person@example.test", password: "test-Password-1234" }, asResponse: true });
  const name = getCookies({ baseURL }).sessionToken.name;
  const cookie = response.headers.getSetCookie().find((line) => line.startsWith(`${name}=`))!.split(";")[0];
  const orphanHeaders = new Headers({ cookie, origin: baseURL });
  expect(f.db.session).toHaveLength(102);
  expect(await f.getIdentitySession(orphanHeaders)).toEqual({ user: { id: a.user.id } });
  const first = await f.auth.api.getSession({ headers: a.headers });
  // Reproduce a native lost list write, independently of the cached token.
  await f.authOptions.secondaryStorage.set(`active-sessions-${a.user.id}`, JSON.stringify([{ token: first!.session.token, expiresAt: Date.now() + 86400_000 }]), 86400);
  await f.auth.api.revokeSessions({ headers: a.headers });
  expect(f.db.session).toHaveLength(0);
  await expect(f.getIdentitySession(orphanHeaders)).rejects.toBeInstanceOf(WebsiteChatIdentityUnavailableError);
  expect(await f.auth.api.getSession({ headers: orphanHeaders })).toBeNull();
}, 15_000);

it.each(storageModes)("%s: enumeration failure and late refresh cannot restore an orphan after revoke-all", async (mode) => {
  const f = fixture(mode === "redis" ? localRedis() : undefined);
  const a = await f.signup();
  const context = await f.auth.$context;
  const session = await f.auth.api.getSession({ headers: a.headers });
  const token = session!.session.token;
  await f.authOptions.secondaryStorage.set(`active-sessions-${a.user.id}`, "[]", 86400);
  const originalSet = f.authOptions.secondaryStorage.set.bind(f.authOptions.secondaryStorage);
  let reached!: () => void;
  let resume!: () => void;
  const paused = new Promise<void>((resolve) => { reached = resolve; });
  const resumed = new Promise<void>((resolve) => { resume = resolve; });
  f.authOptions.secondaryStorage.set = async (key, value, ttl) => {
    if (key === token) { reached(); await resumed; }
    return originalSet(key, value, ttl);
  };
  const refresh = context.internalAdapter.updateSession(token, { expiresAt: new Date(Date.now() + 86400_000) });
  await paused;
  let enumerationFailures = 0;
  const originalFindMany = context.adapter.findMany.bind(context.adapter);
  context.adapter.findMany = async (input) => {
    if (input.model === "session") { enumerationFailures++; throw new Error("synthetic enumeration failure"); }
    return originalFindMany(input);
  };
  await f.auth.api.revokeSessions({ headers: a.headers });
  expect(enumerationFailures).toBeGreaterThan(0);
  resume();
  await refresh;
  expect(f.db.session).toHaveLength(0);
  expect(await f.authOptions.secondaryStorage.get(token)).toBeNull();
  await expect(f.getIdentitySession(a.headers)).rejects.toBeInstanceOf(WebsiteChatIdentityUnavailableError);
  expect(await f.auth.api.getSession({ headers: a.headers })).toBeNull();
});

it.each(storageModes)("%s: native user deletion invalidates cached identity without affecting another user", async (mode) => {
  const f = fixture(mode === "redis" ? localRedis() : undefined);
  const a = await f.signup();
  const b = await f.signup("other@example.test");
  const context = await f.auth.$context;
  await context.internalAdapter.deleteUser(a.user.id);
  await expect(f.getIdentitySession(a.headers)).rejects.toBeInstanceOf(WebsiteChatIdentityUnavailableError);
  expect(await f.auth.api.getSession({ headers: a.headers })).toBeNull();
  expect(await f.getIdentitySession(b.headers)).toEqual({ user: { id: b.user.id } });
});
