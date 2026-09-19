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

export function buildRobots(siteUrl: URL): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Configurators remain crawlable so social preview fetchers never inherit a
        // generic robots block. Their page metadata is still noindex.
        disallow: privateCrawlPaths,
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
        disallow: ["/_next/image", ...privateCrawlPaths],
      },
    ],
    sitemap: new URL("/sitemap.xml", siteUrl).toString(),
  };
}

export default function robots(): MetadataRoute.Robots {
  return buildRobots(getSiteUrl());
}
