import { getDatabase } from "@/server/db/client";
import {
  createDrizzleProductionSavedViewRepository,
  createProductionSavedViewService,
} from "@/server/production/production-saved-view-service";

export function getAdminProductionSavedViewRuntime() {
  return createProductionSavedViewService(
    createDrizzleProductionSavedViewRepository(getDatabase()),
  );
}
