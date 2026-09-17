import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  permanentRedirect: vi.fn((target: string) => {
    throw new Error(`PERMANENT_REDIRECT:${target}`);
  }),
}));

const findByPublicSlug = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => navigation);

vi.mock("@/server/gallery/gallery-runtime", () => ({
  getGalleryRuntime: () => ({
    publicService: {
      findByPublicSlug,
      listRelated: vi.fn().mockResolvedValue([]),
    },
  }),
}));

vi.mock("@/server/admin/product-registry-runtime", () => ({
  getSafePublicProductRegistry: async () => ({ registry: {} }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: () => null }),
}));

import DesignDetailPage from "./page";

describe("retired Design URL continuity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findByPublicSlug.mockResolvedValue(null);
  });

  it("permanently redirects a deleted frozen Design URL to its retained canonical artwork", async () => {
    await expect(DesignDetailPage({
      params: Promise.resolve({
        slug: "canvas-design-example-wedding-362b2e68",
      }),
      searchParams: Promise.resolve({}),
    })).rejects.toThrow(
      "PERMANENT_REDIRECT:/designs/canvas-design-example-wedding-553ad993",
    );

    expect(findByPublicSlug).toHaveBeenCalledWith(
      "canvas-design-example-wedding-362b2e68",
    );
    expect(navigation.permanentRedirect).toHaveBeenCalledWith(
      "/designs/canvas-design-example-wedding-553ad993",
    );
    expect(navigation.notFound).not.toHaveBeenCalled();
  });
});
