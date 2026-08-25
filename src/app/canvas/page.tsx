import { CataloguePage } from "@/components/catalogue-page";
import { getRegistryProducts } from "@/domain/catalogue/product-registry";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import { buildPublicMetadata } from "@/server/seo/metadata";

export const metadata = buildPublicMetadata({
  title: "Custom canvas",
  description: "Personalised photo print, digital oil painting and themed canvas artwork.",
  path: "/canvas",
  image: "/media/products/photo-print-canvas-shop.webp",
  imageAlt: "Personalised photo print canvas",
});
export const dynamic = "force-dynamic";

export default async function CanvasPage() {
  const { registry } = await getSafePublicProductRegistry();
  return (
    <CataloguePage
      eyebrow="CANVAS"
      title="Personalised canvas made from your photos."
      description="Choose photo print, digital oil painting or a custom themed canvas."
      path="/canvas"
      breadcrumbLabel="Canvas"
      relatedLinks={[{
        href: "/custom-photo-canvas-nz",
        label: "Learn more about custom photo canvas",
      }]}
      products={getRegistryProducts(registry).filter(
        (product) => product.active && product.category === "canvas",
      )}
    />
  );
}
