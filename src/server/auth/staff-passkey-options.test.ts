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

it("isolates Preview passkeys to the exact system-provided deployment hostname", () => {
  const env = { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "rnr-task-preview-rrg-allery.vercel.app" };
  const origin = `https://${env.VERCEL_URL}`;
  const options = staffPasskeyOptions(origin, env);
  expect(options.rpID).toBe(env.VERCEL_URL);
  expect(options.origin).toBe(origin);
  expect(options.authenticatorSelection?.userVerification).toBe("required");
  expect(() => staffPasskeyOptions("https://other.vercel.app", env)).toThrow();
  expect(() => staffPasskeyOptions(origin, { ...env, VERCEL_ENV: "production" })).toThrow();
  expect(staffPasskeyOptions("https://rnrgallery.com", env).rpID).toBe("rnrgallery.com");
});
