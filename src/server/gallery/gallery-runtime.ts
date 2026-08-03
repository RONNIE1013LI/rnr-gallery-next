import { getDatabase } from "@/server/db/client";
import { parseGalleryConfig } from "./config";
import { createDrizzleGalleryRepository } from "./drizzle-gallery-repository";
import { createDesignSelectionService } from "./design-selection-service";
import { LocalGalleryStore } from "./local-gallery-store";
import { createPublicGalleryService } from "./public-gallery-service";

let runtime: ReturnType<typeof createRuntime> | undefined;

function createRuntime() {
  const repository = createDrizzleGalleryRepository(getDatabase());
  const store = new LocalGalleryStore(parseGalleryConfig());
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
