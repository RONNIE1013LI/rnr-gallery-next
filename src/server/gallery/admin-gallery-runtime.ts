import { getGalleryRuntime } from "./gallery-runtime";
import { createAdminGalleryService } from "./admin-gallery-service";

let service: ReturnType<typeof createAdminGalleryService> | undefined;

export function getAdminGalleryService() {
  if (!service) {
    const runtime = getGalleryRuntime();
    service = createAdminGalleryService({ repository: runtime.repository, store: runtime.store });
  }
  return service;
}
