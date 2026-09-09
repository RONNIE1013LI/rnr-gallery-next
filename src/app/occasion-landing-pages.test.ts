import { describe, expect, it, vi } from "vitest";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import { occasionLandingPages } from "@/domain/seo/occasion-landing-pages";
import { buildPublicSitemap } from "./sitemap";

vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("@/server/admin/product-registry-runtime", () => ({ getSafePublicProductRegistry: vi.fn(), getProductRegistryRuntime: vi.fn() }));
vi.mock("@/server/gallery/gallery-runtime", () => ({ getGalleryRuntime: vi.fn() }));
const routes = [
  () => import("./birthday-banners/page"), () => import("./1st-birthday-banners/page"),
  () => import("./21st-birthday-banners/page"), () => import("./memorial-banners/page"),
  () => import("./graduation-banners/page"), () => import("./polynesian-banners/page"),
];

describe("six indexable occasion routes", () => {
  it("exports distinct metadata using the central canonical origin", async () => {
    const modules = await Promise.all(routes.map((load) => load()));
    const content = Object.values(occasionLandingPages);
    const titles = new Set(), descriptions = new Set(), headings = new Set();
    modules.forEach(({ metadata, default: Page }, index) => {
      expect(typeof Page).toBe("function");
      expect(metadata.title).toBe(content[index].title);
      expect(metadata.description).toBe(content[index].description);
      expect(metadata.robots).toEqual({ index: true, follow: true });
      expect(metadata.alternates?.canonical).toBe(`https://rnrgallery.com${content[index].path}`);
      expect(metadata.openGraph).toMatchObject({ url: metadata.alternates?.canonical, title: content[index].title, description: content[index].description });
      titles.add(metadata.title); descriptions.add(metadata.description); headings.add(content[index].heading);
    });
    expect([titles.size, descriptions.size, headings.size]).toEqual([6, 6, 6]);
  });
  it("adds each canonical exactly once to the existing sitemap", () => {
    const sitemap = buildPublicSitemap(defaultProductRegistry, new URL("https://rnrgallery.com"));
    const urls = sitemap.map((entry) => entry.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const content of Object.values(occasionLandingPages)) expect(urls.filter((url) => url === `https://rnrgallery.com${content.path}`)).toHaveLength(1);
    expect(urls.some((url) => /\?|www\.|\.co\.nz/.test(url))).toBe(false);
  });
});
