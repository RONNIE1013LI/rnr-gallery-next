import { getDatabase } from "@/server/db/client";
import {
  defaultProductRegistry,
  parseProductRegistry,
} from "@/domain/catalogue/product-registry";
import {
  createDrizzleProductRegistryRepository,
  createProductRegistryService,
} from "./product-registry-service";
import { storefrontMediaExists } from "./storefront-media-path";

export function getProductRegistryRuntime() {
  return createProductRegistryService(
    createDrizzleProductRegistryRepository(getDatabase()),
    { assetExists: storefrontMediaExists },
  );
}

export async function getSafePublicProductRegistry() {
  try {
    return await getProductRegistryRuntime().current();
  } catch {
    return Object.freeze({
      revision: 0,
      registry: parseProductRegistry(defaultProductRegistry),
    });
  }
}
