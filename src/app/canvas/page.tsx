import type { Metadata } from "next";
import { CataloguePage } from "@/components/catalogue-page";
import { getRegistryProducts } from "@/domain/catalogue/product-registry";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";

export const metadata: Metadata = {
  title: "Custom canvas",
  description: "Personalised photo print, digital oil painting and themed canvas artwork.",
  alternates: { canonical: "/canvas" },
};
export const dynamic = "force-dynamic";

export default async function CanvasPage() {
  const { registry } = await getSafePublicProductRegistry();
  return (
    <CataloguePage
      eyebrow="CANVAS"
      title="Personalised canvas made from your photos."
      description="Choose photo print, digital oil painting or a custom themed canvas."
      products={getRegistryProducts(registry).filter(
        (product) => product.active && product.category === "canvas",
      )}
    />
  );
}
