import { describe, expect, it, vi } from "vitest";
import { HttpError } from "./require-session";
import { requireAdminPageFrom } from "./require-admin-page";

describe("requireAdminPageFrom", () => {
  it("redirects signed-out visitors to sign in", async () => {
    const redirectTo = vi.fn(() => { throw new Error("redirected"); });
    await expect(requireAdminPageFrom(
      vi.fn().mockRejectedValue(new HttpError("Unauthorized", 401)),
      redirectTo,
    )).rejects.toThrow("redirected");
    expect(redirectTo).toHaveBeenCalledWith("/account/sign-in?next=/admin/design-gallery");
  });

  it("redirects non-admin customers to their account", async () => {
    const redirectTo = vi.fn(() => { throw new Error("redirected"); });
    await expect(requireAdminPageFrom(
      vi.fn().mockRejectedValue(new HttpError("Forbidden", 403)),
      redirectTo,
    )).rejects.toThrow("redirected");
    expect(redirectTo).toHaveBeenCalledWith("/account");
  });
});
