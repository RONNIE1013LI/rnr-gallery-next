import { afterEach, describe, expect, it, vi } from "vitest";
import { expressCheckoutAvailable, expressCheckoutConfigured } from "./express-checkout-config";

describe("Express Checkout market flags", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("defaults off, allows independent local markets and requires the live kill switch on Vercel", async () => {
    expect(expressCheckoutConfigured("NZ", {})).toBe(false);
    expect(expressCheckoutConfigured("AU", {})).toBe(false);
    expect(await expressCheckoutAvailable("NZ", { EXPRESS_CHECKOUT_NZ: "true" })).toBe(true);
    expect(await expressCheckoutAvailable("AU", { EXPRESS_CHECKOUT_NZ: "true" })).toBe(false);
    expect(expressCheckoutConfigured("NZ", { VERCEL: "1", EXPRESS_CHECKOUT_NZ: "true" })).toBe(false);
  });

  it("observes changes per market without a deployment and fails closed on errors", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ NZ: true, AU: false }))
      .mockResolvedValueOnce(Response.json({ NZ: false, AU: true }))
      .mockRejectedValueOnce(new Error("config unavailable"));
    vi.stubGlobal("fetch", fetch);
    const env = {
      VERCEL: "1", EXPRESS_CHECKOUT_NZ: "true", EXPRESS_CHECKOUT_AU: "true",
      EXPRESS_CHECKOUT_GLOBAL_CONFIG: "https://global-config.vercel.com/test_instance?token=synthetic-token",
    };
    expect(await expressCheckoutAvailable("NZ", env)).toBe(true);
    expect(await expressCheckoutAvailable("NZ", env)).toBe(false);
    expect(await expressCheckoutAvailable("AU", env)).toBe(false);
    expect(String(fetch.mock.calls[0][0])).toBe("https://global-config.vercel.com/test_instance/item/express_checkout");
    expect(fetch.mock.calls[0][1]).toMatchObject({ cache: "no-store", redirect: "error" });
  });
  it.each([
    ["non-OK response", () => new Response(null, { status: 503 })],
    ["malformed JSON", () => new Response("{")],
    ["non-boolean value", () => Response.json({ NZ: "true" })],
    ["missing market", () => Response.json({ AU: true })],
  ] as const)("disables NZ on %s", async (_case, makeResponse) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse()));
    await expect(expressCheckoutAvailable("NZ", {
      VERCEL: "1",
      EXPRESS_CHECKOUT_NZ: "true",
      EXPRESS_CHECKOUT_GLOBAL_CONFIG: "https://global-config.vercel.com/test_instance?token=synthetic-token",
    })).resolves.toBe(false);
  });

});
