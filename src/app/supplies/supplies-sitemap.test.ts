import { describe, expect, it, vi } from "vitest";
import type { SuppliesCatalogue } from "@/domain/supplies/types";
vi.mock("@/server/supplies/catalogue", () => ({ getPublicSuppliesCatalogue: async () => null }));
import { buildSuppliesSitemap } from "../sitemap";

const catalogue: SuppliesCatalogue = {
  settings: { enabled: true, updatedAt: null, updatedBy: null },
  categories: [{ id: "visible", slug: "visible", name: "Supplies", description: "", image: null, sortOrder: 0, archived: false, visible: true }, { id: "hidden", slug: "hidden", name: "Hidden", description: "", image: null, sortOrder: 1, archived: false, visible: false }],
  products: [],
};
describe("Supplies sitemap visibility", () => {
  it("excludes everything while OFF or not initialized", () => {
    expect(buildSuppliesSitemap(null, new URL("https://example.test"))).toEqual([]);
    expect(buildSuppliesSitemap({ ...catalogue, settings: { ...catalogue.settings, enabled: false } }, new URL("https://example.test"))).toEqual([]);
  });
  it("indexes visible categories only and never adds AU URLs", () => {
    expect(buildSuppliesSitemap(catalogue, new URL("https://example.test"))).toEqual([
      { url: "https://example.test/supplies", changeFrequency: "weekly", priority: .7 },
      { url: "https://example.test/supplies/categories/visible", changeFrequency: "weekly", priority: .7 },
    ]);
  });
});
