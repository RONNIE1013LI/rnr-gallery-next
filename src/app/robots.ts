import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/server/seo/site-url";

export function buildRobots(siteUrl: URL): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin/",
          "/account/",
          "/api/",
          "/cart",
          "/checkout",
          "/forms/",
          "/orders/",
          "/pay/",
          "/products/*/configure",
        ],
      },
      {
        userAgent: "meta-externalagent",
        disallow: "/",
      },
    ],
    sitemap: new URL("/sitemap.xml", siteUrl).toString(),
  };
}

export default function robots(): MetadataRoute.Robots {
  return buildRobots(getSiteUrl());
}
