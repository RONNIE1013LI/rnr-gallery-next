import { CataloguePage } from "@/components/catalogue-page";
import { getRegistryProducts } from "@/domain/catalogue/product-registry";
import { getMarketStartingPriceInclTaxCents } from "@/domain/pricing/market-quote";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import { buildPublicMetadata } from "@/server/seo/metadata";

export const metadata = buildPublicMetadata({
  title: "Custom banners",
  description: "Personalised roll-up banners, wall banners and grave covers for meaningful occasions.",
  path: "/banners",
  image: "/media/products/roll-up-banner-shop.webp",
  imageAlt: "Personalised R&R Gallery roll-up banner",
});
export const dynamic = "force-dynamic";

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
      title="Custom banners made for your occasion."
      description="Choose a roll-up banner, wall banner or grave cover, then personalise the details."
      path="/banners"
      breadcrumbLabel="Banners"
      products={products}
      pricesInclTaxCents={pricesInclTaxCents}
    />
  );
}
