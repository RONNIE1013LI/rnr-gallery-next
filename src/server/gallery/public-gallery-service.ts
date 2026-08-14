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
    async findByIds(designIds: readonly string[]) {
      const rows = await Promise.all(designIds.map(async (designId) => {
        const row = await dependencies.repository.findActiveDesign(designId);
        if (!row || !await dependencies.imageAvailable(row.storageKey)) return null;
        return publicItem(row);
      }));
      return Object.freeze(rows.flatMap((row) => row ? [row] : []));
    },
    async list(query: GalleryQuery, requestedPageSize = pageSize) {
      const resolvedPageSize = Number.isSafeInteger(requestedPageSize)
        ? Math.min(pageSize, Math.max(1, requestedPageSize))
        : pageSize;
      const result = await dependencies.repository.listActivePage(query, resolvedPageSize);
      const availability = await Promise.all(result.items.map(async (row) => ({
        row,
        available: await dependencies.imageAvailable(row.storageKey),
      })));
      const available = availability.flatMap(({ row, available }) => available ? [row] : []);
      const total = Math.max(0, result.total - (result.items.length - available.length));
      const pageCount = Math.max(1, Math.ceil(total / pageSize));
      const page = Math.min(result.page, pageCount);
      return Object.freeze({
        items: Object.freeze(available.map(publicItem)),
        total,
        page,
        pageCount,
        pageSize: resolvedPageSize,
      });
    },
  });
}
