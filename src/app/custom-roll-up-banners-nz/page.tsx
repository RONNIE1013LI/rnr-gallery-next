import { notFound } from "next/navigation";
import { AdLandingPage } from "@/components/ad-landing-page";
import { getRegistryProductBySlug } from "@/domain/catalogue/product-registry";
import { getMarketStartingPriceInclTaxCents } from "@/domain/pricing/market-quote";
import { adLandingPages } from "@/domain/ads/landing-pages";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import { buildPublicMetadata } from "@/server/seo/metadata";

const content = adLandingPages.rollUp;

export const metadata = buildPublicMetadata({
  title: "Custom Roll-Up Banners NZ",
  description: "Create a complete 85 × 200 cm custom roll-up banner package with stand, carry bag, proof and two revision rounds.",
  path: content.path,
  image: content.examples[0].src,
  imageAlt: content.examples[0].alt,
});

export default async function CustomRollUpBannersPage() {
  const { registry } = await getSafePublicProductRegistry();
  const product = getRegistryProductBySlug(registry, content.productSlug);
  if (!product) notFound();
  return <AdLandingPage
    content={content}
    product={product}
    priceInclGstCents={getMarketStartingPriceInclTaxCents(registry, "NZ", product.key)}
  />;
}
