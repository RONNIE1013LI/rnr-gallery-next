import { describe, expect, it } from "vitest";
import {
  createOrderEmailAccessToken,
  verifyOrderEmailAccessToken,
} from "./order-email-access";

const secret = "order-email-access-secret-with-sufficient-entropy-12345";
const now = new Date("2026-08-16T06:30:00.000Z");

describe("order email access", () => {
  it("creates a time-limited token bound to one order number", () => {
    const token = createOrderEmailAccessToken("RNR-2026-ABC", secret, now);

    expect(verifyOrderEmailAccessToken(token, "RNR-2026-ABC", secret, now)).toBe(true);
    expect(verifyOrderEmailAccessToken(token, "RNR-2026-OTHER", secret, now)).toBe(false);
  });

  it("rejects expired, malformed and wrongly signed tokens", () => {
    const token = createOrderEmailAccessToken("RNR-2026-ABC", secret, now, 1_000);

    expect(verifyOrderEmailAccessToken(
      token,
      "RNR-2026-ABC",
      secret,
      new Date(now.getTime() + 1_001),
    )).toBe(false);
    expect(verifyOrderEmailAccessToken("not-a-token", "RNR-2026-ABC", secret, now)).toBe(false);
    expect(verifyOrderEmailAccessToken(token, "RNR-2026-ABC", `${secret}-wrong`, now)).toBe(false);
  });
});
