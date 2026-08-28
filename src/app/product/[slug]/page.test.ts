import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";

const route = vi.hoisted(() => ({
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
  permanentRedirect: vi.fn((destination: string) => { throw new Error(`REDIRECT:${destination}`); }),
  registry: undefined as unknown,
}));

vi.mock("next/navigation", () => ({
  notFound: route.notFound,
  permanentRedirect: route.permanentRedirect,
}));
vi.mock("@/server/admin/product-registry-runtime", () => ({
  getSafePublicProductRegistry: async () => ({ registry: route.registry }),
}));

import LegacyProductPage from "./page";

describe("legacy product route", () => {
  beforeEach(() => {
    route.notFound.mockClear();
    route.permanentRedirect.mockClear();
    route.registry = defaultProductRegistry;
  });

  it("returns not found for an unmapped ordinary legacy slug instead of redirecting home", async () => {
    await expect(LegacyProductPage({
      params: Promise.resolve({ slug: "retired-ordinary-product" }),
      searchParams: Promise.resolve({}),
    })).rejects.toThrow("NOT_FOUND");

    expect(route.notFound).toHaveBeenCalledOnce();
    expect(route.permanentRedirect).not.toHaveBeenCalled();
  });

  it("preserves every query parameter when redirecting a local legacy product route", async () => {
    await expect(LegacyProductPage({
      params: Promise.resolve({ slug: "roll-up-banner" }),
      searchParams: Promise.resolve({
        utm_source: "test",
        utm_campaign: "test",
        gclid: "test",
        x: "1",
      }),
    })).rejects.toThrow(
      "REDIRECT:/products/roll-up-banner?utm_source=test&utm_campaign=test&gclid=test&x=1",
    );

    expect(route.permanentRedirect).toHaveBeenCalledWith(
      "/products/roll-up-banner?utm_source=test&utm_campaign=test&gclid=test&x=1",
    );
  });
});
