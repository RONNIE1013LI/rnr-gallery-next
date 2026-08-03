export type GalleryProductTypeSlug =
  | "canvas"
  | "grave-cover"
  | "roll-up-banner"
  | "wall-hanging-banners";

export type GalleryOccasionSlug =
  | "baby-kids"
  | "birthday"
  | "business-promotion"
  | "family-portrait"
  | "general-celebration"
  | "graduation"
  | "memorial"
  | "personalised-artwork"
  | "religious"
  | "wedding";

export type GalleryThemeSlug =
  | "colour-style"
  | "cultural-island"
  | "decoration-style"
  | "kids-characters"
  | "religious-memorial";

export type GalleryProductSlug =
  | "digital-oil-painting-canvas"
  | "custom-themed-canvas"
  | "grave-cover"
  | "roll-up-banner"
  | "custom-themed-wall-banner";

export type GalleryManifestRecord = Readonly<{
  id: string;
  productTypeSlug: GalleryProductTypeSlug;
  occasionSlug: GalleryOccasionSlug;
  subOccasion: string | null;
  themeSlugs: readonly GalleryThemeSlug[];
  sourceFile: string;
  altText: string;
  productSlug: GalleryProductSlug;
}>;
