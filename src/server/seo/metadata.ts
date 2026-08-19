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
  return {
    title,
    description,
    alternates: { canonical },
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
