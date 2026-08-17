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
    title: "Custom canvas Australia",
    description: "Personalised photo print, digital oil painting and themed canvas artwork with fixed AUD pricing.",
    path: "/au/canvas",
    image: "/media/products/photo-print-canvas-shop.webp",
    imageAlt: "Personalised photo print canvas",
  });
}

export default async function AustraliaCanvasPage() {
  const { registry } = await getSafePublicProductRegistry();
  if (!registry.markets.AU.enabled || !getMarketCompleteness(registry, "AU").ready) {
    return <AustraliaUnavailable />;
  }
  const products = getRegistryProducts(registry).filter(
    (product) => product.active && product.category === "canvas",
  );
  const pricesInclTaxCents = Object.fromEntries(products.map((product) => [
    product.key,
    getMarketStartingPriceInclTaxCents(registry, "AU", product.key),
  ]));
  return (
    <CataloguePage
      eyebrow="CANVAS · AUD"
      title="Personalised canvas made from your photos."
      description="Choose photo print, digital oil painting or a custom themed canvas."
      path="/au/canvas"
      breadcrumbLabel="Canvas Australia"
      products={products}
      market="AU"
      pricesInclTaxCents={pricesInclTaxCents}
    />
  );
}
