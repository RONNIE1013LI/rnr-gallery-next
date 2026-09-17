import type { GalleryQuery } from "@/domain/gallery/query";
import {
  publicClassificationForDesign,
  type PublicDesignClassification,
} from "@/domain/gallery/public-classification";
import type {
  PublicGalleryOccasionSlug,
} from "@/domain/gallery/public-taxonomy";
import type { GalleryThemeSlug } from "@/domain/gallery/types";
import { publicDesignIdPrefixFromSlug } from "@/domain/gallery/public-design-slug";
import type { GalleryPublicCandidate, GalleryRepository } from "./gallery-repository";

const pageSize = 24;

export type PublicGalleryItem = Readonly<{
  id: string;
  productTypeSlug: GalleryPublicCandidate["productTypeSlug"];
  occasionSlug: PublicGalleryOccasionSlug;
  subOccasion: string | null;
  themeSlugs: GalleryPublicCandidate["themeSlugs"];
  altText: string;
  productSlug: GalleryPublicCandidate["productSlug"];
  contentHash: string;
  mimeType: GalleryPublicCandidate["mimeType"];
  width: number;
  height: number;
  publicSlug: string;
  displayTitle: string;
  seoTitle: string;
  seoDescription: string;
  intro: string;
  secondaryOccasions: readonly string[];
  palette: readonly string[];
  seoIndex: boolean;
  hiddenFromListings: boolean;
  canonicalDesignId: string | null;
  canonicalPublicSlug: string | null;
}>;

type Dependencies = Readonly<{
  repository: GalleryRepository;
  imageAvailable: (storageKey: string) => Promise<boolean>;
}>;

type ClassifiedCandidate = Readonly<{
  row: GalleryPublicCandidate;
  classification: PublicDesignClassification;
  item: PublicGalleryItem;
}>;

function publicItem(row: GalleryPublicCandidate): PublicGalleryItem {
  const classification = publicClassificationForDesign(row);
  return Object.freeze({
    id: row.id,
    productTypeSlug: row.productTypeSlug,
    occasionSlug: classification.occasionSlug,
    subOccasion: classification.subOccasion,
    themeSlugs: row.themeSlugs,
    altText: row.altText,
    productSlug: row.productSlug,
    contentHash: row.contentHash,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    publicSlug: classification.publicSlug,
    displayTitle: classification.displayTitle,
    seoTitle: classification.seoTitle,
    seoDescription: classification.seoDescription,
    intro: classification.intro,
    secondaryOccasions: classification.secondaryOccasions,
    palette: classification.palette,
    seoIndex: classification.seoIndex,
    hiddenFromListings: classification.hiddenFromListings,
    canonicalDesignId: classification.canonicalDesignId,
    canonicalPublicSlug: classification.canonicalPublicSlug,
  });
}

function classifiedCandidate(row: GalleryPublicCandidate): ClassifiedCandidate {
  const classification = publicClassificationForDesign(row);
  return Object.freeze({
    row,
    classification,
    item: publicItem(row),
  });
}

function matchesQuery(candidate: ClassifiedCandidate, query: GalleryQuery): boolean {
  const { row, item } = candidate;
  if (item.hiddenFromListings) return false;
  if (query.productSlug && row.productSlug !== query.productSlug) return false;
  if (query.productTypes.length > 0 && !query.productTypes.includes(row.productTypeSlug)) {
    return false;
  }
  if (query.occasions.length > 0 && !query.occasions.includes(item.occasionSlug)) {
    return false;
  }
  if (
    query.birthdayAges.length > 0
    && (!item.subOccasion || !query.birthdayAges.includes(item.subOccasion))
  ) {
    return false;
  }
  if (
    query.themes.length > 0
    && !row.themeSlugs.some((theme) => query.themes.includes(theme))
  ) {
    return false;
  }
  return true;
}

function intersectionCount(left: readonly string[], right: readonly string[]) {
  const rightSet = new Set(right);
  return left.reduce((count, value) => count + (rightSet.has(value) ? 1 : 0), 0);
}

function relatedScore(
  current: ClassifiedCandidate,
  candidate: ClassifiedCandidate,
): number {
  if (current.row.id === candidate.row.id) return Number.NEGATIVE_INFINITY;
  if (candidate.item.hiddenFromListings || !candidate.item.seoIndex) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;
  if (current.row.productSlug === candidate.row.productSlug) score += 100;
  if (current.row.productTypeSlug === candidate.row.productTypeSlug) score += 50;
  if (current.item.occasionSlug === candidate.item.occasionSlug) score += 40;
  if (
    current.item.subOccasion
    && current.item.subOccasion === candidate.item.subOccasion
  ) {
    score += 35;
  }
  score += intersectionCount(
    current.item.secondaryOccasions,
    candidate.item.secondaryOccasions,
  ) * 15;
  score += intersectionCount(
    current.row.themeSlugs as readonly GalleryThemeSlug[],
    candidate.row.themeSlugs as readonly GalleryThemeSlug[],
  ) * 10;
  return score;
}

export function createPublicGalleryService(dependencies: Dependencies) {
  return Object.freeze({
    async listSitemapDesigns() {
      const rows = await dependencies.repository.listActiveCandidates();
      const candidates = rows.map(classifiedCandidate).filter(({ item }) =>
        !item.hiddenFromListings && item.seoIndex
      );
      const available = await Promise.all(candidates.map(async (candidate) => ({
        candidate,
        available: await dependencies.imageAvailable(candidate.row.storageKey),
      })));
      return Object.freeze(available.flatMap(({ candidate, available }) =>
        available
          ? [{
              slug: candidate.item.publicSlug,
              createdAt: candidate.row.createdAt,
            }]
          : []
      ));
    },

    async findByPublicSlug(slug: string) {
      const prefix = publicDesignIdPrefixFromSlug(slug);
      const findByPrefix = dependencies.repository.findActiveDesignByIdPrefix;
      if (!prefix || !findByPrefix) return null;
      const row = await findByPrefix(prefix);
      if (!row || !await dependencies.imageAvailable(row.storageKey)) return null;
      return publicItem(row);
    },

    async findByIds(designIds: readonly string[]) {
      const rows = await Promise.all(designIds.map(async (designId) => {
        const row = await dependencies.repository.findActiveDesign(designId);
        if (!row || !await dependencies.imageAvailable(row.storageKey)) return null;
        const item = publicItem(row);
        return item.hiddenFromListings ? null : item;
      }));
      return Object.freeze(rows.flatMap((row) => row ? [row] : []));
    },

    async list(query: GalleryQuery, requestedPageSize = pageSize) {
      const resolvedPageSize = Number.isSafeInteger(requestedPageSize)
        ? Math.min(pageSize, Math.max(1, requestedPageSize))
        : pageSize;
      const rows = await dependencies.repository.listActiveCandidates();
      const filtered = rows.map(classifiedCandidate).filter((candidate) =>
        matchesQuery(candidate, query)
      );
      const total = filtered.length;
      const pageCount = Math.max(1, Math.ceil(total / resolvedPageSize));
      const page = Math.min(query.page, pageCount);
      const start = (page - 1) * resolvedPageSize;
      const pageCandidates = filtered.slice(start, start + resolvedPageSize);
      const availability = await Promise.all(pageCandidates.map(async (candidate) => ({
        candidate,
        available: await dependencies.imageAvailable(candidate.row.storageKey),
      })));
      const items = availability.flatMap(({ candidate, available }) =>
        available ? [candidate.item] : []
      );
      return Object.freeze({
        items: Object.freeze(items),
        total,
        page,
        pageCount,
        pageSize: resolvedPageSize,
      });
    },

    async listRelated(designId: string, requestedLimit = 4) {
      const limit = Number.isSafeInteger(requestedLimit)
        ? Math.min(12, Math.max(1, requestedLimit))
        : 4;
      const currentRow = await dependencies.repository.findActiveDesign(designId);
      if (!currentRow) return Object.freeze([] as PublicGalleryItem[]);
      const current = classifiedCandidate(currentRow);
      const rows = await dependencies.repository.listActiveCandidates();
      const ranked = rows
        .map(classifiedCandidate)
        .map((candidate) => ({
          candidate,
          score: relatedScore(current, candidate),
        }))
        .filter(({ score }) => Number.isFinite(score) && score > 0)
        .sort((left, right) =>
          right.score - left.score
          || right.candidate.row.createdAt.getTime() - left.candidate.row.createdAt.getTime()
          || left.candidate.row.id.localeCompare(right.candidate.row.id)
        );

      const selected: PublicGalleryItem[] = [];
      for (const { candidate } of ranked) {
        if (selected.length >= limit) break;
        if (!await dependencies.imageAvailable(candidate.row.storageKey)) continue;
        selected.push(candidate.item);
      }
      return Object.freeze(selected);
    },
  });
}
