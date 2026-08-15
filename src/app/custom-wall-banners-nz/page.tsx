import { notFound } from "next/navigation";
import { AdLandingPage } from "@/components/ad-landing-page";
import { getRegistryProductBySlug } from "@/domain/catalogue/product-registry";
import { adLandingPages } from "@/domain/ads/landing-pages";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import { buildPublicMetadata } from "@/server/seo/metadata";

const content = adLandingPages.wallBanner;

export const metadata = buildPublicMetadata({
  title: "Custom Wall Banners NZ",
  description: "Create a personalised large-format fabric wall banner with your photos, wording, proof and two revision rounds.",
  path: content.path,
  image: content.examples[0].src,
  imageAlt: content.examples[0].alt,
});

export default async function CustomWallBannersPage() {
  const { registry } = await getSafePublicProductRegistry();
  const product = getRegistryProductBySlug(registry, content.productSlug);
  if (!product) notFound();
  return <AdLandingPage content={content} product={product} />;
}
