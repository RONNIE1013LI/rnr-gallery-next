import { describe, expect, it } from "vitest";
import * as schema from "./index";

describe("staff security schema", () => {
  it("persists MFA enrollment separately from passwords", () => {
    expect(schema.user).toHaveProperty("twoFactorEnabled");
    expect(schema).toHaveProperty("twoFactor");
    expect(schema).toHaveProperty("passkey");
  });
  it("persists revocable staff access, strong sessions and staged rollout", () => {
    expect(schema).toHaveProperty("staffSecurity");
    expect(schema).toHaveProperty("staffSessionSecurity");
    expect(schema).toHaveProperty("staffSecurityPolicy");
  });
});
