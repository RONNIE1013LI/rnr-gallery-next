import { revalidateTag, unstable_cache } from "next/cache";

export const PUBLIC_CACHE_TAGS = Object.freeze({
  content: "rnr-public-content",
  products: "rnr-public-products",
  gallery: "rnr-public-gallery",
  galleryMedia: "rnr-public-gallery-media",
  reviews: "rnr-public-reviews",
  reviewMedia: "rnr-public-review-media",
  sitemap: "rnr-public-sitemap",
});

export const PUBLIC_CACHE_INVALIDATION = Object.freeze({
  content: Object.freeze([PUBLIC_CACHE_TAGS.content]),
  product: Object.freeze([PUBLIC_CACHE_TAGS.products, PUBLIC_CACHE_TAGS.sitemap]),
  pricing: Object.freeze([PUBLIC_CACHE_TAGS.products, PUBLIC_CACHE_TAGS.sitemap]),
  gallery: Object.freeze([
    PUBLIC_CACHE_TAGS.gallery,
    PUBLIC_CACHE_TAGS.galleryMedia,
    PUBLIC_CACHE_TAGS.sitemap,
  ]),
  review: Object.freeze([PUBLIC_CACHE_TAGS.reviews, PUBLIC_CACHE_TAGS.reviewMedia]),
});

export function cachePublicData<TArgs extends unknown[], TResult>(
  loader: (...args: TArgs) => Promise<TResult>,
  key: string,
  tags: readonly string[],
  revalidate: number | false = false,
) {
  return unstable_cache(loader, [`rnr-public:${key}`], {
    tags: [...tags],
    revalidate,
  });
}

export function revalidatePublicCache(tags: readonly string[]) {
  for (const tag of new Set(tags)) revalidateTag(tag, { expire: 0 });
}
