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
    return { title: "Australia ordering is not available yet", robots: { index: false, follow: false } };
  }
  return buildPublicMetadata({
    title: "Custom banners Australia",
    description: "Personalised roll-up banners, wall banners and grave covers with fixed AUD pricing.",
    path: "/au/banners",
    image: "/media/products/roll-up-banner-shop.webp",
    imageAlt: "Personalised R&R Gallery roll-up banner",
  });
}

export default async function AustraliaBannersPage() {
  const { registry } = await getSafePublicProductRegistry();
  if (!registry.markets.AU.enabled || !getMarketCompleteness(registry, "AU").ready) {
    return <AustraliaUnavailable />;
  }
  const products = getRegistryProducts(registry).filter(
    (product) => product.active && product.category === "banners",
  );
  const pricesInclTaxCents = Object.fromEntries(products.map((product) => [
    product.key,
    getMarketStartingPriceInclTaxCents(registry, "AU", product.key),
  ]));
  return (
    <CataloguePage
      eyebrow="BANNERS · AUD"
      title="Custom banners made for your occasion."
      description="Choose a roll-up banner, wall banner or grave cover, then personalise the details."
      path="/au/banners"
      breadcrumbLabel="Banners Australia"
      products={products}
      market="AU"
      pricesInclTaxCents={pricesInclTaxCents}
    />
  );
}
