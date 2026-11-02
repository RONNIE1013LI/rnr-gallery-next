import { describe, expect, it } from "vitest";
import { staffPasskeyOptions } from "./staff-passkey-options";

describe("staff WebAuthn policy", () => {
  it("fixes the production RP and origin and requires biometric/PIN verification", () => {
    const options = staffPasskeyOptions("https://rnrgallery.com");
    expect(options.rpID).toBe("rnrgallery.com");
    expect(options.origin).toBe("https://rnrgallery.com");
    expect(options.authenticatorSelection?.userVerification).toBe("required");
  });
  it("rejects registration or authentication without a library-verified UV flag", async () => {
    const options = staffPasskeyOptions("https://rnrgallery.com");
    await expect(options.registration!.afterVerification!({ verification: { verified: true, registrationInfo: { userVerified: false } } } as never)).rejects.toThrow();
    await expect(options.authentication!.afterVerification!({ verification: { verified: true, authenticationInfo: { userVerified: false } } } as never)).rejects.toThrow();
  });
  it("accepts the official verifier's successful UV result", async () => {
    const options = staffPasskeyOptions("https://rnrgallery.com");
    await expect(options.authentication!.afterVerification!({ verification: { verified: true, authenticationInfo: { userVerified: true } } } as never)).resolves.toBeUndefined();
  });
  it("does not accept the unrelated legacy RP domain", () => {
    expect(() => staffPasskeyOptions("https://rrgallery.co.nz")).toThrow();
  });
  it("accepts only the controlled HTTPS staging origin and rejects Vercel previews", () => {
    const options = staffPasskeyOptions("https://staging.rnrgallery.com");
    expect(options.rpID).toBe("rnrgallery.com");
    expect(options.origin).toBe("https://staging.rnrgallery.com");
    expect(() => staffPasskeyOptions("https://example.vercel.app")).toThrow();
  });
});
