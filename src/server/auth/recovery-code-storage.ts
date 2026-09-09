import { createHash, randomBytes } from "node:crypto";

const storedHash = /^sha256:[a-f0-9]{64}$/;
export function generateStaffRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => randomBytes(20).toString("hex"));
}

export function recoveryCodeForVerification(value: string): string {
  const code = value.trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(code)) throw new Error("Invalid recovery code");
  return `sha256:${createHash("sha256").update(`rnr:recovery:v1\0${code}`).digest("hex")}`;
}

export async function encodeRecoveryCodes(value: string): Promise<string> {
  const codes: unknown = JSON.parse(value);
  if (!Array.isArray(codes) || codes.some((code) => typeof code !== "string")) throw new Error("Invalid recovery code storage");
  // Better Auth's atomic compare-and-swap retains already hashed unused codes.
  return JSON.stringify(codes.map((code: string) => storedHash.test(code) ? code : recoveryCodeForVerification(code)));
}
