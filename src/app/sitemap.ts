import type { MetadataRoute } from "next";
import { getMarketCompleteness } from "@/domain/catalogue/market-price-book";
import type { ProductRegistryDocument } from "@/domain/catalogue/product-registry";
import {
  getProductRegistryRuntime,
  getSafePublicProductRegistry,
} from "@/server/admin/product-registry-runtime";
import { getGalleryRuntime } from "@/server/gallery/gallery-runtime";
import { buildMarketAlternates } from "@/server/seo/metadata";
import { getSiteUrl } from "@/server/seo/site-url";
import { cachePublicData, PUBLIC_CACHE_TAGS } from "@/server/cache/public-cache-tags";

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
  ["/returns-refunds", 0.5, "monthly"],
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
  const australiaReady = registry.markets.AU.enabled &&
    getMarketCompleteness(registry, "AU").ready;
  const entry = (
    pathname: string,
    priority: number,
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"],
  ) => {
    const languages = australiaReady
      ? buildMarketAlternates(pathname, siteUrl)
      : undefined;
    return {
      url: new URL(pathname, siteUrl).toString(),
      priority,
      changeFrequency,
      lastModified: contentLastModified,
      ...(languages ? { alternates: { languages } } : {}),
    };
  };
  return [
    ...pages.map(([pathname, priority, frequency]) => entry(pathname, priority, frequency)),
    ...registry.products.filter((product) => product.active).map((product) =>
      entry(`/products/${product.slug}`, 0.9, "weekly"),
    ),
    ...(australiaReady
      ? [
          entry("/au", 0.8, "weekly"),
          entry("/au/shop", 0.8, "weekly"),
          entry("/au/canvas", 0.8, "weekly"),
          entry("/au/banners", 0.8, "weekly"),
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

async function generatePublicSitemap(): Promise<MetadataRoute.Sitemap> {
  const { registry } = await getProductRegistryRuntime().current();
  const designs = await getGalleryRuntime().publicService.listSitemapDesigns();
  return buildPublicSitemap(registry, getSiteUrl(), designs);
}

const getCachedPublicSitemap = cachePublicData(
  generatePublicSitemap,
  "sitemap",
  [
    PUBLIC_CACHE_TAGS.sitemap,
    PUBLIC_CACHE_TAGS.products,
    PUBLIC_CACHE_TAGS.gallery,
  ],
  172_800,
);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    return await getCachedPublicSitemap();
  } catch {
    const { registry } = await getSafePublicProductRegistry();
    return buildPublicSitemap(registry, getSiteUrl(), []);
  }
}
