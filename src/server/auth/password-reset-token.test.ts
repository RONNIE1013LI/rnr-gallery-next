import { describe, expect, it, vi } from "vitest";

import { validatePasswordResetToken } from "./password-reset-token";

const now = new Date("2026-08-06T08:00:00.000Z");

describe("validatePasswordResetToken", () => {
  it("accepts an existing unexpired token without consuming it", async () => {
    const find = vi.fn().mockResolvedValue({ expiresAt: new Date("2026-08-06T09:00:00.000Z") });
    await expect(validatePasswordResetToken("valid-reset-token", find, now)).resolves.toBe("valid");
    expect(find).toHaveBeenCalledWith("reset-password:valid-reset-token");
  });

  it.each([
    ["", null],
    ["short", null],
    ["used-reset-token", null],
    ["expired-reset-token", { expiresAt: new Date("2026-08-06T07:59:59.000Z") }],
  ])("rejects missing, malformed, used or expired token %s", async (token, record) => {
    const find = vi.fn().mockResolvedValue(record);
    await expect(validatePasswordResetToken(token, find, now)).resolves.toBe("invalid");
  });

  it("does not hide a database availability failure as an invalid token", async () => {
    const find = vi.fn().mockRejectedValue(new Error("database unavailable"));
    await expect(validatePasswordResetToken("valid-reset-token", find, now))
      .rejects.toThrow("database unavailable");
  });
});
