import type { MetadataRoute } from "next";
import { getMarketCompleteness } from "@/domain/catalogue/market-price-book";
import type { ProductRegistryDocument } from "@/domain/catalogue/product-registry";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import { getGalleryRuntime } from "@/server/gallery/gallery-runtime";
import { getSiteUrl } from "@/server/seo/site-url";

const pages = [
  ["/", 1, "weekly"],
  ["/shop", 0.9, "weekly"],
  ["/canvas", 0.8, "weekly"],
  ["/banners", 0.8, "weekly"],
  ["/design-gallery", 0.8, "weekly"],
  ["/how-it-works", 0.6, "monthly"],
  ["/about", 0.5, "monthly"],
  ["/contact", 0.5, "monthly"],
  ["/help", 0.5, "monthly"],
  ["/shipping-delivery", 0.5, "monthly"],
  ["/custom-roll-up-banners-nz", 0.8, "weekly"],
  ["/custom-wall-banners-nz", 0.8, "weekly"],
  ["/custom-photo-canvas-nz", 0.8, "weekly"],
  ["/privacy", 0.2, "yearly"],
  ["/terms", 0.2, "yearly"],
] as const;

const contentLastModified = new Date("2026-08-16T00:00:00+12:00");

export function buildPublicSitemap(
  registry: ProductRegistryDocument,
  siteUrl: URL,
  designs: readonly Readonly<{ slug: string; createdAt: Date }>[] = [],
): MetadataRoute.Sitemap {
  const entry = (
    pathname: string,
    priority: number,
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"],
  ) => ({
    url: new URL(pathname, siteUrl).toString(),
    priority,
    changeFrequency,
    lastModified: contentLastModified,
  });
  const australiaReady = registry.markets.AU.enabled &&
    getMarketCompleteness(registry, "AU").ready;
  return [
    ...pages.map(([pathname, priority, frequency]) => entry(pathname, priority, frequency)),
    ...registry.products.filter((product) => product.active).map((product) =>
      entry(`/products/${product.slug}`, 0.9, "weekly"),
    ),
    ...(australiaReady
      ? [
          entry("/au", 0.8, "weekly"),
          ...registry.products.filter((product) => product.active).map((product) =>
            entry(`/au/products/${product.slug}`, 0.8, "weekly"),
          ),
        ]
      : []),
    ...designs.map((design) => ({
      ...entry(`/designs/${design.slug}`, 0.7, "monthly"),
      lastModified: design.createdAt,
    })),
  ];
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { registry } = await getSafePublicProductRegistry();
  let designs: readonly Readonly<{ slug: string; createdAt: Date }>[] = [];
  try {
    designs = await getGalleryRuntime().publicService.listSitemapDesigns();
  } catch {
    designs = [];
  }
  return buildPublicSitemap(registry, getSiteUrl(), designs);
}
