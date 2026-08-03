import type {
  GalleryOccasionSlug,
  GalleryProductSlug,
  GalleryProductTypeSlug,
  GalleryThemeSlug,
} from "@/domain/gallery/types";

export type GalleryImportRow = Readonly<{
  id: string;
  productTypeSlug: GalleryProductTypeSlug;
  occasionSlug: GalleryOccasionSlug;
  subOccasion: string | null;
  themeSlugs: readonly GalleryThemeSlug[];
  altText: string;
  productSlug: GalleryProductSlug;
  storageKey: string;
  contentHash: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
}>;

export type GalleryPublicCandidate = GalleryImportRow & Readonly<{
  createdAt: Date;
}>;

export type GalleryActiveImage = Readonly<{
  id: string;
  storageKey: string;
  contentHash: string;
  mimeType: GalleryImportRow["mimeType"];
}>;

export interface GalleryRepository {
  replaceInitialImport(
    rows: readonly GalleryImportRow[],
  ): Promise<Readonly<{ imported: number; unchanged: number }>>;
  listActiveCandidates(): Promise<readonly GalleryPublicCandidate[]>;
  findActiveImage(designId: string): Promise<GalleryActiveImage | null>;
}
