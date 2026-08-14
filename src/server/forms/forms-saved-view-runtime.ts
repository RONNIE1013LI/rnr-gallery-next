import { getDatabase } from "@/server/db/client";
import {
  createDrizzleProductionSavedViewRepository,
  createFormsSavedViewService,
} from "@/server/production/production-saved-view-service";

export function getFormsSavedViewRuntime() {
  return createFormsSavedViewService(
    createDrizzleProductionSavedViewRepository(getDatabase()),
  );
}
