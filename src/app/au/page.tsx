import type { Metadata } from "next";
import { homepageGalleryDesignIds } from "@/components/homepage-gallery";
import { HomepageV3 } from "@/components/homepage-v3";
import { AustraliaUnavailable } from "@/components/market-unavailable";
import { getMarketCompleteness } from "@/domain/catalogue/market-price-book";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import { getGalleryRuntime } from "@/server/gallery/gallery-runtime";
import { getSafePublicCustomerReviewSection } from "@/server/customer-reviews/customer-review-runtime";
import type { PublicGalleryItem } from "@/server/gallery/public-gallery-service";
import { buildPublicMetadata } from "@/server/seo/metadata";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { registry } = await getSafePublicProductRegistry();
  if (!registry.markets.AU.enabled || !getMarketCompleteness(registry, "AU").ready) {
    return {
      title: "Australia ordering is not available yet",
      description: "R&R Gallery Australia fixed AUD pricing is being prepared.",
      robots: { index: false, follow: false },
    };
  }
  return buildPublicMetadata({
    title: "Custom Canvas & Banners for Australia",
    description: "Turn your photos into personalised canvas and banners, with fixed AUD pricing and delivery across Australia.",
    path: "/au",
    image: "/media/home/homepage-products-ink-sailboat.webp",
    imageAlt: "Selection of personalised R&R Gallery artwork products",
  });
}

export default async function AustraliaPage() {
  const galleryPromise: Promise<readonly PublicGalleryItem[]> = getGalleryRuntime()
    .publicService.findByIds(homepageGalleryDesignIds)
    .catch(() => []);
  const [{ registry }, galleryItems, reviewSection] = await Promise.all([
    getSafePublicProductRegistry(),
    galleryPromise,
    getSafePublicCustomerReviewSection(),
  ]);
  if (!registry.markets.AU.enabled || !getMarketCompleteness(registry, "AU").ready) {
    return <AustraliaUnavailable />;
  }
  return <HomepageV3 registry={registry} galleryItems={galleryItems} market="AU" reviewSection={reviewSection} />;
}
