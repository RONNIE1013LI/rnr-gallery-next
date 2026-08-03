import type { GalleryQuery } from "@/domain/gallery/query";
import type { GalleryPublicCandidate, GalleryRepository } from "./gallery-repository";

const pageSize = 24;

export type PublicGalleryItem = Readonly<{
  id: string;
  productTypeSlug: GalleryPublicCandidate["productTypeSlug"];
  occasionSlug: GalleryPublicCandidate["occasionSlug"];
  subOccasion: string | null;
  themeSlugs: GalleryPublicCandidate["themeSlugs"];
  altText: string;
  productSlug: GalleryPublicCandidate["productSlug"];
  contentHash: string;
  mimeType: GalleryPublicCandidate["mimeType"];
  width: number;
  height: number;
}>;

type Dependencies = Readonly<{
  repository: GalleryRepository;
  imageAvailable: (storageKey: string) => Promise<boolean>;
}>;

function intersects(left: readonly string[], right: readonly string[]): boolean {
  return right.length === 0 || left.some((value) => right.includes(value));
}

function matches(row: GalleryPublicCandidate, query: GalleryQuery): boolean {
  return (
    (query.productTypes.length === 0 || query.productTypes.includes(row.productTypeSlug)) &&
    (query.occasions.length === 0 || query.occasions.includes(row.occasionSlug)) &&
    (query.birthdayAges.length === 0 || (
      row.subOccasion !== null && query.birthdayAges.includes(row.subOccasion)
    )) &&
    intersects(row.themeSlugs, query.themes)
  );
}

function publicItem(row: GalleryPublicCandidate): PublicGalleryItem {
  return Object.freeze({
    id: row.id,
    productTypeSlug: row.productTypeSlug,
    occasionSlug: row.occasionSlug,
    subOccasion: row.subOccasion,
    themeSlugs: row.themeSlugs,
    altText: row.altText,
    productSlug: row.productSlug,
    contentHash: row.contentHash,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
  });
}

export function createPublicGalleryService(dependencies: Dependencies) {
  return Object.freeze({
    async list(query: GalleryQuery) {
      const candidates = (await dependencies.repository.listActiveCandidates())
        .filter((row) => matches(row, query));
      const available = [];
      for (const row of candidates) {
        if (await dependencies.imageAvailable(row.storageKey)) available.push(row);
      }
      available.sort((left, right) =>
        right.createdAt.getTime() - left.createdAt.getTime() ||
        left.id.localeCompare(right.id),
      );
      const total = available.length;
      const pageCount = Math.max(1, Math.ceil(total / pageSize));
      const page = Math.min(query.page, pageCount);
      const start = (page - 1) * pageSize;
      return Object.freeze({
        items: Object.freeze(available.slice(start, start + pageSize).map(publicItem)),
        total,
        page,
        pageCount,
        pageSize,
      });
    },
  });
}
