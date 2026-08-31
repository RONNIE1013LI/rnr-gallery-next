import { getDatabase } from "@/server/db/client";
import { createDrizzleGalleryRepository } from "./drizzle-gallery-repository";
import { createDesignSelectionService } from "./design-selection-service";
import { createGalleryStore } from "./gallery-store";
import { createPublicGalleryService } from "./public-gallery-service";
import { cachePublicData, PUBLIC_CACHE_TAGS } from "@/server/cache/public-cache-tags";

let runtime: ReturnType<typeof createRuntime> | undefined;

function createRuntime() {
  const repository = createDrizzleGalleryRepository(getDatabase());
  const store = createGalleryStore();
  const uncachedPublicService = createPublicGalleryService({
    repository,
    imageAvailable: (storageKey) => store.isAvailable(storageKey),
  });
  const publicService = Object.freeze({
    listSitemapDesigns: cachePublicData(
      () => uncachedPublicService.listSitemapDesigns(),
      "gallery-sitemap-designs",
      [PUBLIC_CACHE_TAGS.gallery, PUBLIC_CACHE_TAGS.sitemap],
    ),
    findByPublicSlug: cachePublicData(
      (slug: string) => uncachedPublicService.findByPublicSlug(slug),
      "gallery-public-slug",
      [PUBLIC_CACHE_TAGS.gallery],
    ),
    findByIds: cachePublicData(
      (designIds: readonly string[]) => uncachedPublicService.findByIds(designIds),
      "gallery-design-ids",
      [PUBLIC_CACHE_TAGS.gallery],
    ),
    list: cachePublicData(
      (query: Parameters<typeof uncachedPublicService.list>[0], requestedPageSize?: number) => (
        uncachedPublicService.list(query, requestedPageSize)
      ),
      "gallery-list",
      [PUBLIC_CACHE_TAGS.gallery],
    ),
  });
  return Object.freeze({
    repository,
    store,
    publicService,
    selectionService: createDesignSelectionService({
      findActiveDesign: (designId) => repository.findActiveDesign(designId),
      imageAvailable: (storageKey) => store.isAvailable(storageKey),
    }),
  });
}

export function getGalleryRuntime() {
  runtime ??= createRuntime();
  return runtime;
}
