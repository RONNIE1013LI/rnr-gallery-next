import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const worktreeRoot = dirname(fileURLToPath(import.meta.url));

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
  images: {
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
    return [{ source: "/(.*)", headers: buildSecurityHeaders(process.env.NODE_ENV) }];
  },
  async redirects() {
    return [{
      source: "/forms/:path*",
      destination: "/order-system/:path*",
      permanent: false,
    }];
  },
  async rewrites() {
    return [{
      source: "/order-system/:path*",
      destination: "/forms/:path*",
    }];
  },
};

export default nextConfig;
