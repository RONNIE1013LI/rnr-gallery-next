import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  hashWebsiteClientMessageKey,
  parseWebsiteMessageRequest,
  serializeWebsiteSessionCookie,
} from "./public-api";

describe("Website customer chat public API helpers", () => {
  it("accepts only the strict bounded public request shape", () => {
    expect(parseWebsiteMessageRequest({
      clientMessageKey: "A".repeat(22),
      message: "  What details do you need?  ",
      pageContext: { pathname: "/products/roll-up-banner" },
    })).toEqual({
      clientMessageKey: "A".repeat(22),
      message: "What details do you need?",
      pathname: "/products/roll-up-banner",
    });

    expect(() => parseWebsiteMessageRequest({
      clientMessageKey: "A".repeat(22), message: "Hello", extra: true,
    })).toThrow("website_message_request_invalid");
    expect(() => parseWebsiteMessageRequest({
      clientMessageKey: "bad key", message: "Hello",
    })).toThrow("website_message_request_invalid");
    expect(() => parseWebsiteMessageRequest({
      clientMessageKey: "A".repeat(22), message: "x".repeat(2_001),
    })).toThrow("website_message_request_invalid");
    expect(() => parseWebsiteMessageRequest({
      clientMessageKey: "A".repeat(22), message: "😀".repeat(2_001),
    })).toThrow("website_message_request_invalid");
  });

  it("binds the client key to server-owned session identity with HMAC", () => {
    const secret = "website-abuse-secret-that-is-long-enough";
    const conversationHash = "a".repeat(64);
    const clientKey = "B".repeat(22);
    expect(hashWebsiteClientMessageKey({ conversationHash, clientKey, secret })).toBe(
      createHmac("sha256", secret)
        .update(`website-message\0${conversationHash}\0${clientKey}`)
        .digest("hex"),
    );
  });

  it("serializes only the approved secure cookie attributes", () => {
    expect(serializeWebsiteSessionCookie({
      name: "__Host-rnr_customer_chat",
      value: "a".repeat(43),
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
      maxAge: 604_800,
      priority: "high",
    })).toBe(
      `__Host-rnr_customer_chat=${"a".repeat(43)}; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax; Secure; Priority=High`,
    );
  });
});
