import { homepageGalleryDesignIds } from "@/components/homepage-gallery";
import { HomepageV3 } from "@/components/homepage-v3";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import { getGalleryRuntime } from "@/server/gallery/gallery-runtime";
import { getSafePublicCustomerReviewSection } from "@/server/customer-reviews/customer-review-runtime";
import type { PublicGalleryItem } from "@/server/gallery/public-gallery-service";
import { buildPublicMetadata } from "@/server/seo/metadata";

export const dynamic = "force-dynamic";
export const metadata = buildPublicMetadata({
  title: "Custom Canvas & Banners Made in New Zealand",
  socialTitle: "R&R Gallery | Custom Canvas | Banners & Digital Oil Paintings NZ | Free Design Service",
  description: "Turn your photos into personalised canvas and banners, with a proof before printing and delivery across New Zealand and Australia.",
  path: "/",
  image: "/media/social/rr-gallery-social-share-2026.webp",
  imageAlt: "R&R Gallery custom canvas and digital oil painting display",
});

export default async function Home() {
  const galleryPromise: Promise<readonly PublicGalleryItem[]> = getGalleryRuntime()
    .publicService.findByIds(homepageGalleryDesignIds)
    .catch(() => []);
  const [{ registry }, galleryItems, reviewSection] = await Promise.all([
    getSafePublicProductRegistry(),
    galleryPromise,
    getSafePublicCustomerReviewSection(),
  ]);
  return <HomepageV3 registry={registry} galleryItems={galleryItems} reviewSection={reviewSection} />;
}
