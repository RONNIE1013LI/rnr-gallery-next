import type { Metadata } from "next";
import { CataloguePage } from "@/components/catalogue-page";
import { AustraliaUnavailable } from "@/components/market-unavailable";
import { getMarketCompleteness } from "@/domain/catalogue/market-price-book";
import { getRegistryProducts } from "@/domain/catalogue/product-registry";
import { getMarketStartingPriceInclTaxCents } from "@/domain/pricing/market-quote";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import { buildPublicMetadata } from "@/server/seo/metadata";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { registry } = await getSafePublicProductRegistry();
  if (!registry.markets.AU.enabled || !getMarketCompleteness(registry, "AU").ready) {
    return {
      title: "Australia ordering is not available yet",
      robots: { index: false, follow: false },
    };
  }
  return buildPublicMetadata({
    title: "Shop custom artwork in Australia",
    description: "Choose R&R Gallery custom canvas and banners with fixed AUD pricing.",
    path: "/au/shop",
    image: "/media/home/homepage-products-ink-sailboat.webp",
    imageAlt: "Selection of personalised R&R Gallery artwork products",
    includeMarketAlternates: true,
  });
}

export default async function AustraliaShopPage() {
  const { registry } = await getSafePublicProductRegistry();
  if (!registry.markets.AU.enabled || !getMarketCompleteness(registry, "AU").ready) {
    return <AustraliaUnavailable />;
  }
  const products = getRegistryProducts(registry).filter((product) => product.active);
  const pricesInclTaxCents = Object.fromEntries(products.map((product) => [
    product.key,
    getMarketStartingPriceInclTaxCents(registry, "AU", product.key),
  ]));
  return (
    <CataloguePage
      eyebrow="AUSTRALIA · AUD"
      title="Custom artwork for Australia."
      description="Choose a product to see fixed Australian prices and start your personalised order."
      path="/au/shop"
      breadcrumbLabel="Shop Australia"
      products={products}
      market="AU"
      pricesInclTaxCents={pricesInclTaxCents}
    />
  );
}
