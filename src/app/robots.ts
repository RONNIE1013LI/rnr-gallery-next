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

// Only user-triggered Meta previews may fetch payment-page metadata.
// All other private paths stay excluded; generic crawlers retain /pay/ below.
const metaPreviewPrivateCrawlPaths = privateCrawlPaths.filter((path) => path !== "/pay/");

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
        // Shared payment and configurator links need previews, not indexing.
        userAgent: ["facebookexternalhit", "Facebot", "meta-externalfetcher"],
        allow: ["/", "/pay/"],
        disallow: metaPreviewPrivateCrawlPaths,
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
