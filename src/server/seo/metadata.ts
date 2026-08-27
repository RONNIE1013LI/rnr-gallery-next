import type { Metadata } from "next";
import { getSiteUrl } from "./site-url";

type PublicMetadataInput = Readonly<{
  title: string;
  description: string;
  path: string;
  image: string;
  imageAlt: string;
  socialTitle?: string;
}>;

const pairedMarketPaths = new Map<string, string>([
  ["/", "/au"],
  ["/shop", "/au/shop"],
  ["/canvas", "/au/canvas"],
  ["/banners", "/au/banners"],
]);

export function buildMarketAlternates(path: string, siteUrl: URL = getSiteUrl()) {
  let nzPath = path;
  let auPath = pairedMarketPaths.get(path);

  if (!auPath && path.startsWith("/products/")) {
    auPath = `/au${path}`;
  } else if (path === "/au" || path.startsWith("/au/")) {
    auPath = path;
    nzPath = path === "/au" ? "/" : path.slice(3);
    const expectedAuPath = pairedMarketPaths.get(nzPath)
      ?? (nzPath.startsWith("/products/") ? `/au${nzPath}` : undefined);
    if (expectedAuPath !== auPath) return undefined;
  }

  if (!auPath) return undefined;
  const absolute = (pathname: string) => new URL(pathname, siteUrl).toString();
  return {
    "en-NZ": absolute(nzPath),
    "en-AU": absolute(auPath),
    "x-default": absolute(nzPath),
  };
}

export function absoluteSiteUrl(path: string): string {
  return new URL(path, getSiteUrl()).toString();
}

export function buildPublicMetadata({
  title,
  description,
  path,
  image,
  imageAlt,
  socialTitle,
}: PublicMetadataInput): Metadata {
  const canonical = absoluteSiteUrl(path);
  const socialImage = absoluteSiteUrl(image);
  const shareTitle = socialTitle ?? title;
  const languages = buildMarketAlternates(path);
  return {
    title,
    description,
    alternates: {
      canonical,
      ...(languages ? { languages } : {}),
    },
    openGraph: {
      type: "website",
      title: shareTitle,
      description,
      url: canonical,
      images: [{ url: socialImage, alt: imageAlt }],
    },
    twitter: {
      card: "summary_large_image",
      title: shareTitle,
      description,
      images: [socialImage],
    },
    robots: { index: true, follow: true },
  };
}

export function buildBreadcrumbData(
  entries: readonly Readonly<{ name: string; path: string }>[],
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: entries.map((entry, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: entry.name,
      item: absoluteSiteUrl(entry.path),
    })),
  } as const;
}
