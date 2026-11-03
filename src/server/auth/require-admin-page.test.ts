import { describe, expect, it, vi } from "vitest";
import { HttpError } from "./require-session";
import { requireAdminPage, requireAdminPageFrom } from "./require-admin-page";

const permissionGate = vi.hoisted(() => vi.fn());
vi.mock("./require-admin", () => ({ requireAdminPermission: permissionGate }));

describe("requireAdminPageFrom", () => {
  it("redirects signed-out visitors to sign in", async () => {
    const redirectTo = vi.fn(() => { throw new Error("redirected"); });
    await expect(requireAdminPageFrom(
      vi.fn().mockRejectedValue(new HttpError("Unauthorized", 401)),
      redirectTo,
      "/admin/orders?status=paid",
    )).rejects.toThrow("redirected");
    expect(redirectTo).toHaveBeenCalledWith(
      "/account/sign-in?next=%2Fadmin%2Forders%3Fstatus%3Dpaid",
    );
  });

  it("preserves Reply Assistant as the signed-out return target", async () => {
    const redirectTo = vi.fn(() => { throw new Error("redirected"); });
    await expect(requireAdminPageFrom(
      vi.fn().mockRejectedValue(new HttpError("Unauthorized", 401)),
      redirectTo,
      "/reply-assistant",
    )).rejects.toThrow("redirected");
    expect(redirectTo).toHaveBeenCalledWith(
      "/account/sign-in?next=%2Freply-assistant",
    );
  });

  it("redirects non-admin customers to their account", async () => {
    const redirectTo = vi.fn(() => { throw new Error("redirected"); });
    await expect(requireAdminPageFrom(
      vi.fn().mockRejectedValue(new HttpError("Forbidden", 403)),
      redirectTo,
      "/admin",
    )).rejects.toThrow("redirected");
    expect(redirectTo).toHaveBeenCalledWith("/account");
  });

  it("rejects unsafe return paths", async () => {
    const redirectTo = vi.fn(() => { throw new Error("redirected"); });
    await expect(requireAdminPageFrom(
      vi.fn().mockRejectedValue(new HttpError("Unauthorized", 401)),
      redirectTo,
      "https://attacker.example/admin",
    )).rejects.toThrow("redirected");
    expect(redirectTo).toHaveBeenCalledWith("/account/sign-in?next=%2Fadmin");
  });
});

describe("admin page authorization mode", () => {
  it("forwards explicit read mode and the requested permission", async () => {
    permissionGate.mockResolvedValue({ user: { id: "owner-test" } });
    await requireAdminPage("/admin/users", "manage_roles", { readOnly: true });
    expect(permissionGate).toHaveBeenLastCalledWith("manage_roles", { readOnly: true });
  });
  it("preserves action mode by default", async () => {
    permissionGate.mockResolvedValue({ user: { id: "owner-test" } });
    await requireAdminPage("/admin/users/new", "manage_roles");
    expect(permissionGate).toHaveBeenLastCalledWith("manage_roles", undefined);
  });
});
