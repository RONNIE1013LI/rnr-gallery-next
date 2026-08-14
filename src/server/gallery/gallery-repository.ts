import type {
  GalleryOccasionSlug,
  GalleryProductSlug,
  GalleryProductTypeSlug,
  GalleryThemeSlug,
} from "@/domain/gallery/types";
import type { GalleryQuery } from "@/domain/gallery/query";

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

export type GalleryAdminRecord = GalleryPublicCandidate & Readonly<{
  status: "active" | "trashed";
  trashedAt: Date | null;
  updatedAt: Date;
}>;

export type GalleryAdminUpdate = Partial<Omit<GalleryImportRow, "id">>;

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
  listActivePage(
    query: GalleryQuery,
    pageSize: number,
  ): Promise<Readonly<{
    items: readonly GalleryPublicCandidate[];
    total: number;
    page: number;
    pageCount: number;
  }>>;
  findActiveImage(designId: string): Promise<GalleryActiveImage | null>;
  findActiveDesign(designId: string): Promise<GalleryPublicCandidate | null>;
}

export interface AdminGalleryRepository {
  listAdminCandidates(): Promise<readonly GalleryAdminRecord[]>;
  findDesign(designId: string): Promise<GalleryAdminRecord | null>;
  createDesign(row: GalleryImportRow, actorUserId: string): Promise<void>;
  updateDesign(designId: string, update: GalleryAdminUpdate, actorUserId: string): Promise<boolean>;
  setDesignStatus(designId: string, status: "active" | "trashed", actorUserId: string): Promise<boolean>;
}
