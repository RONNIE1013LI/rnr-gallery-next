import type { PasskeyOptions } from "@better-auth/passkey";
import { APIError } from "better-auth/api";

export function staffPasskeyOptions(origin: string): PasskeyOptions {
  const url = new URL(origin);
  const controlledOrigin = url.origin === "https://rnrgallery.com" || url.origin === "https://staging.rnrgallery.com";
  const localOrigin = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (!controlledOrigin && !localOrigin) {
    throw new Error("Staff Passkeys require a controlled R&R Gallery origin or local development");
  }
  return {
    rpID: controlledOrigin ? "rnrgallery.com" : url.hostname,
    rpName: "R&R Gallery Staff",
    origin: url.origin,
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    registration: {
      afterVerification: async ({ verification }) => {
        if (!verification.verified || !verification.registrationInfo?.userVerified) throw new APIError("UNAUTHORIZED", { message: "Device verification is required." });
      },
    },
    authentication: {
      afterVerification: async ({ verification }) => {
        if (!verification.verified || !verification.authenticationInfo.userVerified) throw new APIError("UNAUTHORIZED", { message: "Device verification is required." });
      },
    },
  };
}
