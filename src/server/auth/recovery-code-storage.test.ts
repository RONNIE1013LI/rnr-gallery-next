import { describe, expect, it } from "vitest";
import { generateStaffRecoveryCodes, encodeRecoveryCodes, recoveryCodeForVerification } from "./recovery-code-storage";

describe("hashed recovery code storage", () => {
  it("generates high-entropy unique codes and stores only their hashes", async () => {
    const codes = generateStaffRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(codes.every((code) => /^[a-f0-9]{40}$/.test(code))).toBe(true);
    const stored = await encodeRecoveryCodes(JSON.stringify(codes));
    for (const code of codes) expect(stored).not.toContain(code);
    expect(JSON.parse(stored)).toEqual(codes.map(recoveryCodeForVerification));
  });
  it("does not double hash retained entries when Better Auth consumes a code", async () => {
    const stored = await encodeRecoveryCodes(JSON.stringify(generateStaffRecoveryCodes()));
    const retained = JSON.parse(stored).slice(1);
    expect(await encodeRecoveryCodes(JSON.stringify(retained))).toBe(JSON.stringify(retained));
  });
  it("never accepts a stolen storage hash as a recovery credential", () => {
    const code = generateStaffRecoveryCodes()[0];
    expect(() => recoveryCodeForVerification(recoveryCodeForVerification(code))).toThrow();
    expect(() => recoveryCodeForVerification("123456")).toThrow();
  });
});
