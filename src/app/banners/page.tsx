import { CataloguePage } from "@/components/catalogue-page";
import { CatalogueBuyingGuide } from "@/components/catalogue-buying-guide";
import { getMarketCompleteness } from "@/domain/catalogue/market-price-book";
import { getRegistryProducts } from "@/domain/catalogue/product-registry";
import { getMarketStartingPriceInclTaxCents } from "@/domain/pricing/market-quote";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import { buildPublicMetadata } from "@/server/seo/metadata";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { registry } = await getSafePublicProductRegistry();
  return buildPublicMetadata({
    title: "Custom Banners NZ | Birthday & Memorial Banners",
    description: "Personalised birthday, memorial and event banners in New Zealand. Explore roll-up banners, fabric wall banners and matching banner bundles.",
    path: "/banners",
    image: "/media/products/roll-up-banner-shop.webp",
    imageAlt: "Personalised R&R Gallery roll-up banner",
    includeMarketAlternates: registry.markets.AU.enabled && getMarketCompleteness(registry, "AU").ready,
  });
}

export default async function BannersPage() {
  const { registry } = await getSafePublicProductRegistry();
  const products = getRegistryProducts(registry).filter(
    (product) => product.active && product.category === "banners",
  );
  const pricesInclTaxCents = products.some((product) => product.key === "banner-bundle")
    ? { "banner-bundle": getMarketStartingPriceInclTaxCents(
        registry,
        "NZ",
        "banner-bundle",
      ) }
    : undefined;
  return (
    <CataloguePage
      eyebrow="BANNERS"
      title="Custom Banners in New Zealand"
      description="Create a personalised banner for a birthday, memorial or event. Compare roll-up banners, fabric wall banners and matching packages before starting your design."
      path="/banners"
      breadcrumbLabel="Banners"
      showProductDetailLinks
      products={products}
      pricesInclTaxCents={pricesInclTaxCents}
    >
      <CatalogueBuyingGuide category="banners" market="NZ" />
    </CataloguePage>
  );
}
