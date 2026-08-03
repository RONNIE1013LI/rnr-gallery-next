import type {
  GalleryOccasionSlug,
  GalleryProductSlug,
  GalleryProductTypeSlug,
  GalleryThemeSlug,
} from "./types";

export const galleryProductTypes = Object.freeze({
  canvas: Object.freeze([
    "digital-oil-painting-canvas",
    "custom-themed-canvas",
  ]),
  "grave-cover": Object.freeze(["grave-cover"]),
  "roll-up-banner": Object.freeze(["roll-up-banner"]),
  "wall-hanging-banners": Object.freeze(["custom-themed-wall-banner"]),
} satisfies Record<GalleryProductTypeSlug, readonly GalleryProductSlug[]>);

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
  "/product/digital-oil-painting-canvas/": "digital-oil-painting-canvas",
  "/product/custom-themed-canvas/": "custom-themed-canvas",
  "/product/grave-cover/": "grave-cover",
  "/product/roll-up-banner/": "roll-up-banner",
  "/product/custom-themed-wall-banner/": "custom-themed-wall-banner",
} satisfies Record<string, GalleryProductSlug>);
