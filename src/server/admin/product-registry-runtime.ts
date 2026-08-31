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
import { cachePublicData, PUBLIC_CACHE_TAGS } from "@/server/cache/public-cache-tags";

export function getProductRegistryRuntime() {
  return createProductRegistryService(
    createDrizzleProductRegistryRepository(getDatabase()),
    { assetExists: storefrontMediaExists },
  );
}

const getCachedPublicProductRegistry = cachePublicData(
  async () => getProductRegistryRuntime().current(),
  "product-registry",
  [PUBLIC_CACHE_TAGS.products],
);

export async function getSafePublicProductRegistry() {
  try {
    return await getCachedPublicProductRegistry();
  } catch {
    return Object.freeze({
      revision: 0,
      registry: parseProductRegistry(defaultProductRegistry),
    });
  }
}
