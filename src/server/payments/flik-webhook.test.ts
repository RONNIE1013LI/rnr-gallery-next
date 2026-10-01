// @vitest-environment node
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyFlikWebhook } from "./flik-webhook";
const now = 1_800_000_000_000;
const secret = "whsec_fixture";
const event = { event: "checkout_session.completed", createdAt: "2027-01-15T08:00:00Z", checkoutSessionId: "cs_fixture", transactionId: "0b0f1e2d-3c4b-5a69-8778-96a5b4c3d2e1", foreignTransactionId: "attempt-1" };
const body = JSON.stringify(event);
function signature(raw = body, timestamp = Math.floor(now / 1000)) {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.`).update(raw).digest("hex")},t=${timestamp}`;
}
describe("Flik signed webhook", () => {
  it("verifies exact raw bytes and returns durable deduplication identifiers", () => {
    expect(verifyFlikWebhook(Buffer.from(body), signature(), secret, now)).toEqual(event);
  });
  it.each([null, "", "t=1800000000", "t=1800000000,v1=aa", "t=1800000000,t=1800000000,v1=aa"]) ("rejects missing or malformed signature %s", (header) => {
    expect(() => verifyFlikWebhook(body, header, secret, now)).toThrow("Invalid Flik webhook");
  });
  it("rejects reserialization and wrong secret", () => {
    expect(() => verifyFlikWebhook(`${body} `, signature(), secret, now)).toThrow();
    expect(() => verifyFlikWebhook(body, signature(), "whsec_wrong", now)).toThrow();
  });
  it.each([-301, 301])("rejects stale and future replay at %s seconds", (offset) => {
    expect(() => verifyFlikWebhook(body, signature(body, now / 1000 + offset), secret, now)).toThrow();
  });
  it("ignores signed future event types", () => {
    const future = JSON.stringify({ event: "new.event" });
    expect(verifyFlikWebhook(future, signature(future), secret, now)).toBeNull();
  });
  it("rejects malformed or legacy unsigned payloads", () => {
    for (const raw of ["{", "{}", JSON.stringify({ ...event, checkoutSessionId: null }), JSON.stringify({ ...event, foreignTransactionId: null })]) {
      expect(() => verifyFlikWebhook(raw, signature(raw), secret, now)).toThrow();
    }
  });
});
