import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WEBSITE_SESSION_MAX_AGE_SECONDS,
  bootstrapWebsiteSession,
  createWebsiteSessionPermit,
  createWebsiteSessionToken,
  ensureWebsiteSessionForPost,
  hashWebsiteConversationKey,
  hashWebsiteSessionToken,
  isWebsiteSessionToken,
  readWebsiteSessionToken,
  resolveWebsiteSession,
  validateWebsiteSessionPermit,
  websiteSessionCookie,
  websiteSessionPublicState,
} from "./session";

const secret = "website-session-secret-that-is-long-enough";
const now = new Date("2026-08-21T00:00:00.000Z");

function request(method: "GET" | "POST", token?: string) {
  return new Request("https://rrgallery.co.nz/api/customer-chat", {
    method,
    headers: token ? { cookie: `__Host-rnr_customer_chat=${token}` } : undefined,
  });
}

describe("website customer session", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("creates opaque 32-byte base64url tokens", () => {
    const first = createWebsiteSessionToken();
    const second = createWebsiteSessionToken();

    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isWebsiteSessionToken(first)).toBe(true);
    expect(isWebsiteSessionToken("not-a-session")).toBe(false);
  });

  it("stores only domain-separated HMAC-SHA256 hashes", () => {
    const token = "a".repeat(43);
    const tokenHash = hashWebsiteSessionToken(token, secret);
    const conversationHash = hashWebsiteConversationKey(token, secret);

    expect(tokenHash).toBe(createHmac("sha256", secret).update(`session-token\0${token}`).digest("hex"));
    expect(conversationHash).toBe(createHmac("sha256", secret).update(`conversation\0${token}`).digest("hex"));
    expect(tokenHash).not.toBe(conversationHash);
    expect(tokenHash).not.toContain(token);
  });

  it("uses a seven-day HttpOnly SameSite=Lax cookie that is secure outside local development", () => {
    const preview = websiteSessionCookie("a".repeat(43), "preview");
    const production = websiteSessionCookie("a".repeat(43), "production");
    const local = websiteSessionCookie("a".repeat(43), "development");

    expect(preview).toMatchObject({
      name: "__Host-rnr_customer_chat",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
      maxAge: WEBSITE_SESSION_MAX_AGE_SECONDS,
    });
    expect(production.secure).toBe(true);
    expect(local).toMatchObject({ name: "rnr_customer_chat", secure: false });
    expect(WEBSITE_SESSION_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 7);
  });

  it("falls back to NODE_ENV when VERCEL_ENV is unavailable", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "production");

    expect(websiteSessionCookie("a".repeat(43)).secure).toBe(true);
  });

  it("reads only a valid environment-appropriate cookie", () => {
    const token = "a".repeat(43);
    expect(readWebsiteSessionToken(request("GET", token), "preview")).toBe(token);
    expect(readWebsiteSessionToken(new Request("http://localhost", {
      headers: { cookie: `rnr_customer_chat=${token}` },
    }), "development")).toBe(token);
    expect(readWebsiteSessionToken(new Request("https://rrgallery.co.nz", {
      headers: { cookie: "__Host-rnr_customer_chat=bad" },
    }), "production")).toBeNull();
  });

  it("creates a stateless bootstrap cookie and exact-key permit without a repository write", async () => {
    const repository = { resolveWebsiteSession: vi.fn().mockResolvedValue(null) };
    const token = "b".repeat(43);
    const result = await bootstrapWebsiteSession({
      request: request("POST"),
      repository,
      sessionSecret: secret,
      permitSecret: "website-permit-secret-that-is-long-enough",
      clientMessageKey: "M".repeat(22),
      now,
      environment: "preview",
      createToken: () => token,
      createNonce: () => "n".repeat(22),
    });

    expect(repository.resolveWebsiteSession).not.toHaveBeenCalled();
    expect(result.cookie).toMatchObject({ value: token, httpOnly: true, secure: true });
    expect(validateWebsiteSessionPermit({
      permit: result.permit,
      token,
      clientMessageKey: "M".repeat(22),
      now,
      sessionSecret: secret,
      permitSecret: "website-permit-secret-that-is-long-enough",
    })).toEqual({ sessionExpiresAt: new Date("2026-08-28T00:00:00.000Z") });
  });

  it("binds permits to the exact cookie token, key, expiry and secret", () => {
    const token = "c".repeat(43);
    const permitSecret = "website-permit-secret-that-is-long-enough";
    const permit = createWebsiteSessionPermit({
      token,
      clientMessageKey: "K".repeat(22),
      sessionExpiresAt: new Date("2026-08-28T00:00:00.000Z"),
      now,
      sessionSecret: secret,
      permitSecret,
      nonce: "n".repeat(22),
    });
    const validate = (overrides: Partial<Parameters<typeof validateWebsiteSessionPermit>[0]> = {}) => validateWebsiteSessionPermit({
      permit,
      token,
      clientMessageKey: "K".repeat(22),
      now,
      sessionSecret: secret,
      permitSecret,
      ...overrides,
    });

    expect(validate()).toEqual({ sessionExpiresAt: new Date("2026-08-28T00:00:00.000Z") });
    expect(validate({ token: "d".repeat(43) })).toBeNull();
    expect(validate({ clientMessageKey: "L".repeat(22) })).toBeNull();
    expect(validate({ permitSecret: "different-permit-secret-that-is-long-enough" })).toBeNull();
    expect(validate({ now: new Date("2026-08-21T00:01:31.000Z") })).toBeNull();
    expect(validate({ permit: `${permit}x` })).toBeNull();
    expect(validate({ permit: `${permit.slice(0, -1)}x` })).toBeNull();
  });

  it("GET-style resolution never creates a session", async () => {
    const repository = {
      resolveWebsiteSession: vi.fn().mockResolvedValue(null),
      ensureWebsiteSession: vi.fn(),
    };

    await expect(resolveWebsiteSession({ request: request("GET"), repository, secret, now, environment: "preview" }))
      .resolves.toBeNull();
    expect(repository.resolveWebsiteSession).not.toHaveBeenCalled();
    expect(repository.ensureWebsiteSession).not.toHaveBeenCalled();
  });

  it("invalid and expired sessions resolve to null without renewal", async () => {
    const token = "a".repeat(43);
    const repository = {
      resolveWebsiteSession: vi.fn().mockResolvedValue(null),
      ensureWebsiteSession: vi.fn(),
    };

    await expect(resolveWebsiteSession({ request: request("GET", token), repository, secret, now, environment: "preview" }))
      .resolves.toBeNull();
    expect(repository.resolveWebsiteSession).toHaveBeenCalledWith({
      sessionTokenHash: hashWebsiteSessionToken(token, secret),
      now,
    });
    expect(repository.ensureWebsiteSession).not.toHaveBeenCalled();
  });

  it("POST creates a session once and later reuses it without extending the absolute expiry", async () => {
    const token = "a".repeat(43);
    const expiresAt = new Date(now.getTime() + WEBSITE_SESSION_MAX_AGE_SECONDS * 1_000);
    const repository = {
      resolveWebsiteSession: vi.fn()
        .mockResolvedValue({ conversationId: "conversation-1", expiresAt }),
      ensureWebsiteSession: vi.fn().mockResolvedValue({ conversationId: "conversation-1", expiresAt }),
    };

    const created = await ensureWebsiteSessionForPost({
      request: request("POST"),
      repository,
      secret,
      now,
      environment: "preview",
      createToken: () => token,
    });
    expect(created.cookie).toMatchObject({ value: token, maxAge: WEBSITE_SESSION_MAX_AGE_SECONDS });
    expect(repository.ensureWebsiteSession).toHaveBeenCalledWith({
      sessionTokenHash: hashWebsiteSessionToken(token, secret),
      externalConversationKeyHash: hashWebsiteConversationKey(token, secret),
      now,
      expiresAt,
    });

    const reused = await ensureWebsiteSessionForPost({
      request: request("POST", token),
      repository,
      secret,
      now: new Date(now.getTime() + 60_000),
      environment: "preview",
    });
    expect(reused.cookie).toBeNull();
    expect(reused.session.expiresAt).toEqual(expiresAt);
    expect(repository.ensureWebsiteSession).toHaveBeenLastCalledWith({
      sessionTokenHash: hashWebsiteSessionToken(token, secret),
      externalConversationKeyHash: hashWebsiteConversationKey(token, secret),
      now: new Date(now.getTime() + 60_000),
      expiresAt,
    });
    expect(repository.ensureWebsiteSession).toHaveBeenCalledTimes(2);
  });

  it("rejects session creation from non-POST requests", async () => {
    const repository = {
      resolveWebsiteSession: vi.fn(),
      ensureWebsiteSession: vi.fn(),
    };
    await expect(ensureWebsiteSessionForPost({
      request: request("GET"),
      repository,
      secret,
      now,
      environment: "preview",
    })).rejects.toThrow("website_session_post_required");
  });

  it("exposes neither raw tokens nor internal identifiers in public state", () => {
    const state = websiteSessionPublicState({
      conversationId: "private-conversation-id",
      expiresAt: new Date("2026-08-28T00:00:00.000Z"),
    });
    const serialized = JSON.stringify(state);

    expect(state).toEqual({ active: true, expiresAt: "2026-08-28T00:00:00.000Z" });
    expect(serialized).not.toContain("private-conversation-id");
    expect(serialized).not.toContain("token");
  });
});
