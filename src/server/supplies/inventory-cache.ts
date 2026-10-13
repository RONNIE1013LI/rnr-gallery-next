import { PUBLIC_CACHE_TAGS, revalidatePublicCache } from "@/server/cache/public-cache-tags";
export function invalidateSuppliesInventory() {
  revalidatePublicCache([PUBLIC_CACHE_TAGS.products, PUBLIC_CACHE_TAGS.sitemap]);
}
