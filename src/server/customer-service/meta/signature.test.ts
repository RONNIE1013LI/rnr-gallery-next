import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyMetaSignature } from "./signature";

describe("Meta webhook signature", () => {
  const rawBody = new TextEncoder().encode('{"object":"page"}');
  const appSecret = "test-app-secret";
  const digest = createHmac("sha256", appSecret).update(rawBody).digest("hex");

  it("accepts a valid sha256 signature", () => {
    expect(verifyMetaSignature({ rawBody, signatureHeader: `sha256=${digest}`, appSecret })).toBe(true);
  });

  it("rejects missing, malformed, wrong length and tampered signatures", () => {
    expect(verifyMetaSignature({ rawBody, signatureHeader: null, appSecret })).toBe(false);
    expect(verifyMetaSignature({ rawBody, signatureHeader: "sha1=abc", appSecret })).toBe(false);
    expect(verifyMetaSignature({ rawBody, signatureHeader: "sha256=aa", appSecret })).toBe(false);
    expect(verifyMetaSignature({ rawBody: new TextEncoder().encode("tampered"), signatureHeader: `sha256=${digest}`, appSecret })).toBe(false);
  });
});
