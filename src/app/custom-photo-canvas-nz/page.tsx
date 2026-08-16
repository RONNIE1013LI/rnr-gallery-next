import { notFound } from "next/navigation";
import { AdLandingPage } from "@/components/ad-landing-page";
import { getRegistryProductBySlug } from "@/domain/catalogue/product-registry";
import { getMarketStartingPriceInclTaxCents } from "@/domain/pricing/market-quote";
import { adLandingPages } from "@/domain/ads/landing-pages";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import { buildPublicMetadata } from "@/server/seo/metadata";

const content = adLandingPages.photoCanvas;

export const metadata = buildPublicMetadata({
  title: "Custom Photo Canvas NZ",
  description: "Create a gallery-wrapped custom photo canvas in A4 to A0 sizes with landscape or portrait orientation and proof before printing.",
  path: content.path,
  image: content.examples[0].src,
  imageAlt: content.examples[0].alt,
});

export default async function CustomPhotoCanvasPage() {
  const { registry } = await getSafePublicProductRegistry();
  const product = getRegistryProductBySlug(registry, content.productSlug);
  if (!product) notFound();
  return <AdLandingPage
    content={content}
    product={product}
    priceInclGstCents={getMarketStartingPriceInclTaxCents(registry, "NZ", product.key)}
  />;
}
