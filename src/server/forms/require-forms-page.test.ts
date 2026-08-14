import { describe, expect, it, vi } from "vitest";

import { HttpError } from "@/server/auth/require-session";
import { requireFormsPageFrom } from "./require-forms-page";

describe("requireFormsPageFrom", () => {
  it("redirects signed-out operators to the dedicated sign-in page", async () => {
    const redirectTo = vi.fn(() => { throw new Error("redirected"); });
    await expect(requireFormsPageFrom(
      vi.fn().mockRejectedValue(new HttpError("Unauthorized", 401)),
      redirectTo,
      "/order-system?urgent=yes",
    )).rejects.toThrow("redirected");
    expect(redirectTo).toHaveBeenCalledWith(
      "/order-system/sign-in?next=%2Forder-system%3Furgent%3Dyes",
    );
  });

  it("redirects authenticated users without forms access to their account", async () => {
    const redirectTo = vi.fn(() => { throw new Error("redirected"); });
    await expect(requireFormsPageFrom(
      vi.fn().mockRejectedValue(new HttpError("Forbidden", 403)),
      redirectTo,
      "/order-system",
    )).rejects.toThrow("redirected");
    expect(redirectTo).toHaveBeenCalledWith("/account");
  });

  it("replaces unsafe requested paths with the forms root", async () => {
    const redirectTo = vi.fn(() => { throw new Error("redirected"); });
    await expect(requireFormsPageFrom(
      vi.fn().mockRejectedValue(new HttpError("Unauthorized", 401)),
      redirectTo,
      "https://evil.example/forms",
    )).rejects.toThrow("redirected");
    expect(redirectTo).toHaveBeenCalledWith("/order-system/sign-in?next=%2Forder-system");
  });
});
