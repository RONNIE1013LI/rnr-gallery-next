import type { Metadata } from "next";
import { homepageGalleryDesignIds } from "@/components/homepage-gallery";
import { HomepageV3 } from "@/components/homepage-v3";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import { getGalleryRuntime } from "@/server/gallery/gallery-runtime";
import type { PublicGalleryItem } from "@/server/gallery/public-gallery-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { alternates: { canonical: "/" } };

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
