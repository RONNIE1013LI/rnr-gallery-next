import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const worktreeRoot = dirname(fileURLToPath(import.meta.url));

const legacyDomainHostPattern = "(?:www\\.)?rnrgallery\\.com|(?:www\\.)?rrgallery\\.co\\.nz";

const legacyPathRedirectGroups = [
  { destination: "/design-gallery", sources: ["/gallery"] },
  { destination: "/about", sources: ["/about-rr"] },
  { destination: "/privacy", sources: ["/cookies-policy"] },
  { destination: "/canvas", sources: ["/product-category/canvas"] },
  { destination: "/banners", sources: ["/product-category/banner"] },
  {
    destination: "/products/roll-up-banner",
    sources: [
      "/product-category/banner/roll-up-banner",
      "/product/roll-up-banner-with-free-professional-custom-design",
      "/product/roll-up-banner-with-free-professional-custom-design-for-loss-of-loved-one",
      "/product/roll-up-banner-with-free-professional-custom-design-for-wedding-anniversary",
      "/product/roll-up-banner-with-free-professional-custom-design-for-business",
      "/product/roll-up-banner-with-free-professional-custom-design-for-21st-birthday",
      "/product/21st-birthday",
      "/product/roll-up-banner-with-free-professional-custom-design-for-5th-birthday",
      "/product/roll-up-banner-with-free-professional-custom-design-for-1st-birthday",
    ],
  },
  {
    destination: "/products/digital-oil-painting-canvas",
    sources: [
      "/product/digital-oil-painting-with-canvas",
      "/product/five-faces-customized-digital-oil-painting-with-canvas",
      "/product/four-faces-customized-digital-oil-painting-with-canvas",
      "/product/three-faces-customized-digital-oil-painting-with-canvas",
      "/product/two-faces-customized-digital-oil-painting-with-canvas",
      "/product/six-faces-or-more-customized-digital-oil-painting-with-canvas",
      "/product/turn-a-low-quality-image-into-a-refined-artwork-ready-for-display-with-canvas",
      "/product/poor-photo-to-a-masterpiece",
      "/product-category/canvas/customized-digital-oil-painting-on-canvas",
    ],
  },
  { destination: "/products/banner-bundle", sources: ["/product/banner-bundle"] },
  {
    destination: "/products/custom-themed-canvas",
    sources: [
      "/product/custom-heart-shaped-photo-collage-on-canvas",
      "/product/custom-number-photo-collage-with-canvas",
      "/product/custom-daddy-photos-collage-with-canvas",
      "/product/multi-photo-artwork-blends-on-canvas-copy",
      "/product-category/canvas/custom-collage-photos-on-canvas",
    ],
  },
  {
    destination: "/products/photo-print-canvas",
    sources: [
      "/product/portrait-photo-printing-with-canvas",
      "/product/landscape-photo-printing",
      "/product/wedding-photo-printing",
      "/product-category/canvas/normal-canvas",
    ],
  },
  {
    destination: "/products/digital-oil-painting-banner",
    sources: [
      "/product/single-face-customized-digital-oil-painting-on-banner",
      "/product/single-face-digital-painting-on-banner-copy",
      "/product/two-face-digital-painting-on-banner",
      "/product/four-face-digital-painting-on-banner",
      "/product/five-face-digital-painting-on-banner",
      "/product/six-faces-digital-painting-on-banner",
    ],
  },
  {
    destination: "/products/custom-themed-wall-banner",
    sources: [
      "/product/custom-themed-banner",
      "/product-category/banner/landscape-banner",
    ],
  },
] as const;

const legacyPathRedirects = legacyPathRedirectGroups.flatMap(({ destination, sources }) =>
  sources.map((source) => [source, `https://rnrgallery.com${destination}`] as const),
);

export function buildSecurityHeaders(nodeEnv: string | undefined) {
  const headers = [
    {
      key: "Content-Security-Policy",
      value: "object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(self)",
    },
  ];
  if (nodeEnv === "production") {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains",
    });
  }
  return headers;
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.4.199"],
  skipTrailingSlashRedirect: true,
  images: {
    deviceSizes: [480, 640, 750, 828, 1080, 1200, 1920, 2048],
    imageSizes: [32, 48, 64, 96, 128, 256, 320, 384],
    qualities: [60, 75],
    unoptimized: process.env.VERCEL_ENV === "preview",
    localPatterns: [
      { pathname: "/**", search: "" },
      { pathname: "/gallery-images/**" },
    ],
  },
  devIndicators: false,
  onDemandEntries: {
    maxInactiveAge: 12 * 60 * 60 * 1_000,
    pagesBufferLength: 64,
  },
  turbopack: {
    root: worktreeRoot,
  },
  async headers() {
    return [
      { source: "/(.*)", headers: buildSecurityHeaders(process.env.NODE_ENV) },
      {
        source: "/notification-email/verify/:token",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
  async redirects() {
    return [
      ...legacyPathRedirects.flatMap(([source, destination]) =>
        [source, `${source}/`].map((sourceVariant) => ({
          source: sourceVariant,
          destination,
          statusCode: 301,
          has: [{ type: "host" as const, value: legacyDomainHostPattern }],
        }))),
      {
        source: "/:path((?!api(?:/|$)).*)",
        destination: "https://rnrgallery.com/:path*",
        statusCode: 301,
        has: [{ type: "host", value: "www\\.rnrgallery\\.com" }],
      },
      {
        source: "/:path((?!api(?:/|$)).*)",
        destination: "https://rnrgallery.com/:path*",
        statusCode: 301,
        has: [{ type: "host", value: "rrgallery\\.co\\.nz" }],
      },
      {
        source: "/:path((?!api(?:/|$)).*)",
        destination: "https://rnrgallery.com/:path*",
        statusCode: 301,
        has: [{ type: "host", value: "www\\.rrgallery\\.co\\.nz" }],
      },
      {
        source: "/forms/:path*",
        destination: "/order-system/:path*",
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return [{
      source: "/order-system/:path*",
      destination: "/forms/:path*",
    }];
  },
};

export default nextConfig;
