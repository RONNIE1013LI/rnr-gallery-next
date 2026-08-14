import { describe, expect, it, vi } from "vitest";

import { HttpError } from "./require-session";
import { requireAccountPageFrom } from "./require-account-page";

describe("requireAccountPageFrom", () => {
  it.each([
    "/account/orders",
    "/account/orders/RNR-2026-ABC?tab=payment",
    "/account/addresses#saved",
  ])("preserves the exact safe account destination %s", async (requestedPath) => {
    const redirect = vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); });
    const verify = vi.fn().mockRejectedValue(new HttpError("Unauthorized", 401));

    await expect(requireAccountPageFrom(verify, redirect, requestedPath))
      .rejects.toThrow(`REDIRECT:/account/sign-in?next=${encodeURIComponent(requestedPath)}`);
  });

  it.each([
    "https://evil.example/account",
    "//evil.example/account",
    "javascript:alert(1)",
    "/shop",
  ])("rejects an unsafe destination %s", async (requestedPath) => {
    const redirect = vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); });
    const verify = vi.fn().mockRejectedValue(new HttpError("Unauthorized", 401));

    await expect(requireAccountPageFrom(verify, redirect, requestedPath))
      .rejects.toThrow("REDIRECT:/account/sign-in?next=%2Faccount");
  });
});
