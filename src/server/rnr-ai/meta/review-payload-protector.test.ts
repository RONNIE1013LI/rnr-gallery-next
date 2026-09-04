import { describe, expect, it } from "vitest";
import { createMetaReviewPayloadProtector } from "./review-payload-protector";

describe("Meta review payload protector", () => {
  it("encrypts review content with authenticated encryption and binds it to the review key", () => {
    const protector = createMetaReviewPayloadProtector("review-secret-that-is-at-least-32-characters", {
      randomBytes: () => Buffer.alloc(12, 7),
    });
    const payload = { risk: "YELLOW" as const, replyText: "Private customer reply", reasons: ["review"] };
    const ciphertext = protector.seal("a".repeat(64), payload);
    expect(ciphertext).toMatch(/^v1\./);
    expect(ciphertext).not.toContain("Private customer reply");
    expect(protector.open("a".repeat(64), ciphertext)).toEqual(payload);
    expect(() => protector.open("b".repeat(64), ciphertext)).toThrow(/invalid/i);
  });

  it("rejects malformed keys, ciphertext and payloads", () => {
    expect(() => createMetaReviewPayloadProtector("short")).toThrow(/key/i);
    const protector = createMetaReviewPayloadProtector("review-secret-that-is-at-least-32-characters");
    expect(() => protector.open("bad", "v1.bad.bad.bad")).toThrow(/invalid/i);
  });
});
