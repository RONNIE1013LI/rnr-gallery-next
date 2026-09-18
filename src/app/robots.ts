import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/server/seo/site-url";

const privateCrawlPaths = [
  "/admin/",
  "/account/",
  "/api/",
  "/cart",
  "/checkout",
  "/forms/",
  "/order-system",
  "/orders/",
  "/pay/",
];

const configureCrawlPaths = [
  "/products/*/configure",
  "/au/products/*/configure",
];

export function buildRobots(siteUrl: URL): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [...privateCrawlPaths, ...configureCrawlPaths],
      },
      {
        // User-shared configurator links need previews, not search indexing.
        // Keep every private/transactional path excluded for these agents too.
        userAgent: ["facebookexternalhit", "Facebot", "meta-externalfetcher"],
        allow: "/",
        disallow: privateCrawlPaths,
      },
      {
        userAgent: "meta-externalagent",
        disallow: "/",
      },
      {
        userAgent: "meta-webindexer",
        allow: "/",
        disallow: ["/_next/image", ...privateCrawlPaths, ...configureCrawlPaths],
      },
    ],
    sitemap: new URL("/sitemap.xml", siteUrl).toString(),
  };
}

export default function robots(): MetadataRoute.Robots {
  return buildRobots(getSiteUrl());
}
