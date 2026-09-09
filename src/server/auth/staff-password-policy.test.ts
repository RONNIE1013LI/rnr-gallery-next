import { describe, expect, it } from "vitest";
import { validStaffPassword } from "./staff-password-policy";
describe("staff password policy", () => {
  it.each([undefined, null, 123, "short", "a".repeat(129), "PASSWORD123456", "111111111111"])("rejects invalid or common passwords", (value) => {
    expect(validStaffPassword(value)).toBe(false);
  });
  it("accepts a long passphrase without arbitrary character composition", () => {
    expect(validStaffPassword("four unusual words for staff")).toBe(true);
  });
});
