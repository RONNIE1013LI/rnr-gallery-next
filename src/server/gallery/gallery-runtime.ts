import { getDatabase } from "@/server/db/client";
import { createDrizzleGalleryRepository } from "./drizzle-gallery-repository";
import { createDesignSelectionService } from "./design-selection-service";
import { createGalleryStore } from "./gallery-store";
import { createPublicGalleryService } from "./public-gallery-service";

let runtime: ReturnType<typeof createRuntime> | undefined;

function createRuntime() {
  const repository = createDrizzleGalleryRepository(getDatabase());
  const store = createGalleryStore();
  return Object.freeze({
    repository,
    store,
    publicService: createPublicGalleryService({
      repository,
      imageAvailable: (storageKey) => store.isAvailable(storageKey),
    }),
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
