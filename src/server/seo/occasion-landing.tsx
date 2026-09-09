import { cookies, headers } from "next/headers";
import { OccasionLandingPage } from "@/components/occasion-landing-page";
import { getMarketCompleteness } from "@/domain/catalogue/market-price-book";
import { defaultProductRegistry, getRegistryProductBySlug, type ProductRegistryDocument } from "@/domain/catalogue/product-registry";
import { occasionLandingPages, selectOccasionArtwork, type OccasionLandingContent, type OccasionLandingSlug } from "@/domain/seo/occasion-landing-pages";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import { getGalleryRuntime } from "@/server/gallery/gallery-runtime";
import type { createPublicGalleryService } from "@/server/gallery/public-gallery-service";
import { MARKET_COOKIE_NAME, parseMarketCookie } from "@/server/markets/market-cookie";
import { buildPublicMetadata } from "./metadata";

type GalleryService = Pick<ReturnType<typeof createPublicGalleryService>, "list">;

export async function loadOccasionArtwork(content: OccasionLandingContent, registry: ProductRegistryDocument, service: GalleryService) {
  const pageSize = Math.floor(24 / content.query.productTypes.length);
  const results = await Promise.all(content.query.productTypes.map((productTypeSlug) =>
    service.list({ ...content.query, page: 1, productTypes: [productTypeSlug] }, pageSize),
  ));
  const activeSlugs = new Set(registry.products.filter((product) => product.active).map((product) => product.slug));
  return selectOccasionArtwork(content, results.flatMap((result) => result.items).filter((item) => activeSlugs.has(item.productSlug)));
}

export function buildOccasionMetadata(slug: OccasionLandingSlug) {
  const content = occasionLandingPages[slug];
  const product = getRegistryProductBySlug(defaultProductRegistry, content.productSlugs[0])!;
  return buildPublicMetadata({ ...content, image: product.image.src, imageAlt: product.image.alt });
}

export async function renderOccasionLanding(slug: OccasionLandingSlug) {
  const content = occasionLandingPages[slug];
  const [{ registry }, cookieStore, requestHeaders] = await Promise.all([
    getSafePublicProductRegistry(), cookies(), headers(),
  ]);
  const savedMarket = parseMarketCookie(requestHeaders.get("x-rnr-resolved-market"))
    ?? parseMarketCookie(cookieStore.get(MARKET_COOKIE_NAME)?.value);
  const market = savedMarket === "AU" && registry.markets.AU.enabled && getMarketCompleteness(registry, "AU").ready ? "AU" : "NZ";
  let artwork: Awaited<ReturnType<typeof loadOccasionArtwork>> = [];
  let artworkUnavailable = false;
  try {
    artwork = await loadOccasionArtwork(content, registry, getGalleryRuntime().publicService);
  } catch {
    artworkUnavailable = true;
  }
  return <OccasionLandingPage content={content} registry={registry} market={market} artwork={artwork} artworkUnavailable={artworkUnavailable} />;
}
