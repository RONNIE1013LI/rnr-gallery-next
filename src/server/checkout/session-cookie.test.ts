import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHECKOUT_SESSION_COOKIE_NAME,
  createCheckoutSessionToken,
  getCheckoutSessionCookieName,
  hashCheckoutSessionToken,
  isCheckoutSessionToken,
  sessionCookie,
  readCheckoutSessionToken,
} from "./session-cookie";

describe("checkout session cookie", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("creates high-entropy opaque tokens and only exposes their digest for persistence", () => {
    const first = createCheckoutSessionToken();
    const second = createCheckoutSessionToken();

    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashCheckoutSessionToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashCheckoutSessionToken(first)).not.toContain(first);
  });

  it("uses an HttpOnly SameSite=Lax site-wide cookie", () => {
    expect(sessionCookie("opaque", "development")).toEqual({
      name: CHECKOUT_SESSION_COOKIE_NAME,
      value: "opaque",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: false,
      maxAge: 60 * 60 * 24 * 30,
    });
  });

  it("uses a different opaque cookie name for Guest, User A, and User B", () => {
    const guest = getCheckoutSessionCookieName(null);
    const userA = getCheckoutSessionCookieName("customer-a");
    const userB = getCheckoutSessionCookieName("customer-b");
    expect(new Set([guest, userA, userB]).size).toBe(3);
    expect(userA).not.toContain("customer-a");
  });

  it("marks the cookie Secure in production", () => {
    expect(sessionCookie("opaque", "production").secure).toBe(true);
  });

  it("cannot downgrade Secure when the real runtime is production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(sessionCookie("opaque", "development").secure).toBe(true);
  });

  it("reads only a correctly shaped opaque token from request cookies", () => {
    const token = "a".repeat(43);
    expect(
      readCheckoutSessionToken(
        new Request("https://shop.example.test", {
          headers: { Cookie: `other=1; ${CHECKOUT_SESSION_COOKIE_NAME}=${token}` },
        }),
      ),
    ).toBe(token);
    expect(
      readCheckoutSessionToken(
        new Request("https://shop.example.test", {
          headers: { Cookie: `${CHECKOUT_SESSION_COOKIE_NAME}=not-valid` },
        }),
      ),
    ).toBeNull();
  });

  it("shares one token-shape validator across request and server component readers", () => {
    expect(isCheckoutSessionToken("a".repeat(43))).toBe(true);
    expect(isCheckoutSessionToken("not-valid")).toBe(false);
  });
});
