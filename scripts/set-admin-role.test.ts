import { describe, expect, it, vi } from "vitest";
import { parseAdminRoleArguments, setAdminRole } from "./set-admin-role";

describe("admin role CLI", () => {
  it("accepts exactly grant or revoke plus one normalized email", () => {
    expect(parseAdminRoleArguments(["grant", " Owner@Example.COM "])).toEqual({
      action: "grant",
      email: "owner@example.com",
    });
    expect(parseAdminRoleArguments(["revoke", "owner@example.com"])).toEqual({
      action: "revoke",
      email: "owner@example.com",
    });
    expect(() => parseAdminRoleArguments(["delete", "owner@example.com"])).toThrow();
    expect(() => parseAdminRoleArguments(["grant"])).toThrow();
    expect(() => parseAdminRoleArguments(["grant", "not-email"])).toThrow();
  });

  it("updates one exact normalized email and reports not found without broad changes", async () => {
    const updateExactEmail = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect(setAdminRole(
      { action: "grant", email: "owner@example.com" },
      { updateExactEmail },
    )).resolves.toBe("Admin role granted.");
    expect(updateExactEmail).toHaveBeenCalledWith("owner@example.com", "admin");

    await expect(setAdminRole(
      { action: "revoke", email: "missing@example.com" },
      { updateExactEmail },
    )).resolves.toBe("No matching user.");
    expect(updateExactEmail).toHaveBeenLastCalledWith("missing@example.com", "customer");
  });
});
