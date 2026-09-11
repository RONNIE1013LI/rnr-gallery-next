import type {
  GalleryOccasionSlug,
  GalleryProductSlug,
  GalleryProductTypeSlug,
  GalleryThemeSlug,
} from "./types";

export const galleryProductTypes = Object.freeze({
  canvas: Object.freeze([
    "photo-print-canvas",
    "digital-oil-painting-canvas",
    "custom-themed-canvas",
  ]),
  "grave-cover": Object.freeze(["grave-cover"]),
  "roll-up-banner": Object.freeze(["roll-up-banner"]),
  "wall-hanging-banners": Object.freeze(["custom-themed-wall-banner", "digital-oil-painting-banner"]),
} satisfies Record<GalleryProductTypeSlug, readonly GalleryProductSlug[]>);

export function galleryDesignTypeForProduct(slug: string): GalleryProductTypeSlug | undefined {
  if (slug === "photo-print-canvas") return "canvas";
  return (Object.keys(galleryProductTypes) as GalleryProductTypeSlug[]).find((type) =>
    galleryProductTypes[type].some((productSlug) => productSlug === slug),
  );
}

export const galleryOccasions = Object.freeze([
  "baby-kids",
  "birthday",
  "business-promotion",
  "family-portrait",
  "general-celebration",
  "graduation",
  "memorial",
  "personalised-artwork",
  "religious",
  "wedding",
] satisfies readonly GalleryOccasionSlug[]);

export const galleryThemes = Object.freeze([
  "colour-style",
  "cultural-island",
  "decoration-style",
  "kids-characters",
  "religious-memorial",
] satisfies readonly GalleryThemeSlug[]);

export const galleryTargetProducts: Readonly<Record<string, GalleryProductSlug>> = Object.freeze({
  "/product/photo-print-canvas/": "photo-print-canvas",
  "/product/digital-oil-painting-canvas/": "digital-oil-painting-canvas",
  "/product/custom-themed-canvas/": "custom-themed-canvas",
  "/product/grave-cover/": "grave-cover",
  "/product/roll-up-banner/": "roll-up-banner",
  "/product/custom-themed-wall-banner/": "custom-themed-wall-banner",
  "/product/digital-oil-painting-banner/": "digital-oil-painting-banner",
} satisfies Record<string, GalleryProductSlug>);
