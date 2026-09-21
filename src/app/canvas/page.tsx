import { CataloguePage } from "@/components/catalogue-page";
import { CatalogueBuyingGuide } from "@/components/catalogue-buying-guide";
import { getMarketCompleteness } from "@/domain/catalogue/market-price-book";
import { getRegistryProducts } from "@/domain/catalogue/product-registry";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import { buildPublicMetadata } from "@/server/seo/metadata";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { registry } = await getSafePublicProductRegistry();
  return buildPublicMetadata({
    title: "Canvas Prints NZ | Personalised Canvas",
    description: "Turn your photos into personalised canvas prints in New Zealand. Compare photo print, digital oil painting and custom themed canvas options.",
    path: "/canvas",
    image: "/media/products/photo-print-canvas-shop.webp",
    imageAlt: "Personalised photo print canvas",
    includeMarketAlternates: registry.markets.AU.enabled && getMarketCompleteness(registry, "AU").ready,
  });
}

export default async function CanvasPage() {
  const { registry } = await getSafePublicProductRegistry();
  return (
    <CataloguePage
      eyebrow="CANVAS"
      title="Custom Canvas Prints in New Zealand"
      description="Choose a photo print, digital oil painting or themed canvas made from your photos. Compare the options below to find the right finish for your artwork."
      path="/canvas"
      breadcrumbLabel="Canvas"
      showProductDetailLinks
      products={getRegistryProducts(registry).filter(
        (product) => product.active && product.category === "canvas",
      )}
    >
      <CatalogueBuyingGuide category="canvas" />
    </CataloguePage>
  );
}
