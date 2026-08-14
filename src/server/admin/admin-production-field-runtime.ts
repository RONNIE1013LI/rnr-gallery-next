import { getDatabase } from "@/server/db/client";
import { createDrizzleProductionFieldRepository } from "@/server/production/drizzle-production-field-repository";
import { createProductionFieldService } from "@/server/production/production-field-service";

export function getAdminProductionFieldRuntime() {
  return createProductionFieldService(
    createDrizzleProductionFieldRepository(getDatabase()),
  );
}
