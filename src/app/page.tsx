import { homepageGalleryDesignIds } from "@/components/homepage-gallery";
import { HomepageV3 } from "@/components/homepage-v3";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import { getGalleryRuntime } from "@/server/gallery/gallery-runtime";
import type { PublicGalleryItem } from "@/server/gallery/public-gallery-service";
import { buildPublicMetadata } from "@/server/seo/metadata";

export const dynamic = "force-dynamic";
export const metadata = buildPublicMetadata({
  title: "Custom Canvas & Banners Made in New Zealand",
  description: "Turn your photos into personalised canvas and banners, with a proof before printing and delivery across New Zealand and Australia.",
  path: "/",
  image: "/media/home/digital-oil-painting-canvas-hero-landscape-01.webp",
  imageAlt: "Personalised digital oil painting canvas displayed in a home",
});

export default async function Home() {
  const { registry } = await getSafePublicProductRegistry();
  let galleryItems: readonly PublicGalleryItem[] = [];

  try {
    const service = getGalleryRuntime().publicService;
    galleryItems = await service.findByIds(homepageGalleryDesignIds);
  } catch {
    galleryItems = [];
  }

  return <HomepageV3 registry={registry} galleryItems={galleryItems} />;
}
