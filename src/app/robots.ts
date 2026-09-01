import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/server/seo/site-url";

const privateCrawlPaths = [
  "/admin/",
  "/account/",
  "/api/",
  "/cart",
  "/checkout",
  "/forms/",
  "/orders/",
  "/pay/",
  "/products/*/configure",
];

export function buildRobots(siteUrl: URL): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
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
