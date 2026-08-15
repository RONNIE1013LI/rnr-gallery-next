import type { MetadataRoute } from "next";
import type { ProductRegistryDocument } from "@/domain/catalogue/product-registry";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import { getSiteUrl } from "@/server/seo/site-url";

const pages = [
  ["/", 1, "weekly"],
  ["/shop", 0.9, "weekly"],
  ["/canvas", 0.8, "weekly"],
  ["/banners", 0.8, "weekly"],
  ["/design-gallery", 0.8, "weekly"],
  ["/how-it-works", 0.6, "monthly"],
  ["/privacy", 0.2, "yearly"],
  ["/terms", 0.2, "yearly"],
] as const;

const contentLastModified = new Date("2026-08-16T00:00:00+12:00");

export function buildPublicSitemap(
  registry: ProductRegistryDocument,
  siteUrl: URL,
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
  return [
    ...pages.map(([pathname, priority, frequency]) => entry(pathname, priority, frequency)),
    ...registry.products.filter((product) => product.active).map((product) =>
      entry(`/products/${product.slug}`, 0.9, "weekly"),
    ),
  ];
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { registry } = await getSafePublicProductRegistry();
  return buildPublicSitemap(registry, getSiteUrl());
}
