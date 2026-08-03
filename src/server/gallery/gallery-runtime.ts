import { getDatabase } from "@/server/db/client";
import { parseGalleryConfig } from "./config";
import { createDrizzleGalleryRepository } from "./drizzle-gallery-repository";
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
  });
}

export function getGalleryRuntime() {
  runtime ??= createRuntime();
  return runtime;
}
