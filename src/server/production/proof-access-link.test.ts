import { describe, expect, it } from "vitest";
import { signProofAccess, verifyProofAccess } from "./proof-access-link";

const secret = "proof-access-secret-with-more-than-thirty-two-characters";
const payload = Object.freeze({
  orderNumber: "RNR-2026-ABC123",
  fileId: "10000000-0000-4000-8000-000000000001",
  expires: 1_786_000_000,
});

describe("signed customer proof access", () => {
  it("accepts only the exact unexpired order and file payload", () => {
    const signature = signProofAccess(payload, secret);

    expect(verifyProofAccess(payload, signature, secret, new Date((payload.expires - 1) * 1000))).toBe(true);
    expect(verifyProofAccess({ ...payload, orderNumber: "RNR-2026-OTHER" }, signature, secret, new Date((payload.expires - 1) * 1000))).toBe(false);
    expect(verifyProofAccess({ ...payload, fileId: "20000000-0000-4000-8000-000000000002" }, signature, secret, new Date((payload.expires - 1) * 1000))).toBe(false);
    expect(verifyProofAccess(payload, signature, secret, new Date(payload.expires * 1000))).toBe(false);
  });

  it("accepts the new numeric order format while retaining legacy links", () => {
    const numeric = { ...payload, orderNumber: "08000" };
    const signature = signProofAccess(numeric, secret);
    expect(verifyProofAccess(numeric, signature, secret, new Date((numeric.expires - 1) * 1000))).toBe(true);
    expect(() => signProofAccess(payload, secret)).not.toThrow();
  });

  it.each(["", "not-hex", "a".repeat(63), "a".repeat(66)])(
    "fails closed for malformed signature %s",
    (signature) => {
      expect(verifyProofAccess(payload, signature, secret, new Date(0))).toBe(false);
    },
  );

  it("rejects malformed payloads instead of signing ambiguous data", () => {
    expect(() => signProofAccess({ ...payload, fileId: "not-a-uuid" }, secret)).toThrow();
    expect(() => signProofAccess(payload, "short")).toThrow();
  });
});
