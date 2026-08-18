import { describe, expect, it } from "vitest";
import { digestPaymentRequestToken, generatePaymentRequestToken } from "./token";

describe("payment request tokens", () => {
  it("generates 32-byte URL-safe secrets and stores only a digest", () => {
    const first = generatePaymentRequestToken();
    const second = generatePaymentRequestToken();

    expect(first.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(first.digest).toBe(digestPaymentRequestToken(first.rawToken));
    expect(second.rawToken).not.toBe(first.rawToken);
    expect(second.digest).not.toBe(first.digest);
    expect(first.digest).not.toContain(first.rawToken);
  });

  it("rejects malformed public tokens before lookup", () => {
    expect(() => digestPaymentRequestToken("short")).toThrow("Invalid payment token");
    expect(() => digestPaymentRequestToken("!".repeat(43))).toThrow("Invalid payment token");
  });
});
