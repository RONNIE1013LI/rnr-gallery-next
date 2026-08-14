import type { Metadata } from "next";
import { CataloguePage } from "@/components/catalogue-page";
import { getRegistryProducts } from "@/domain/catalogue/product-registry";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";

export const metadata: Metadata = {
  title: "Custom banners",
  description: "Personalised roll-up banners, wall banners and grave covers for meaningful occasions.",
  alternates: { canonical: "/banners" },
};
export const dynamic = "force-dynamic";

export default async function BannersPage() {
  const { registry } = await getSafePublicProductRegistry();
  return (
    <CataloguePage
      eyebrow="BANNERS"
      title="Custom banners made for your occasion."
      description="Choose a roll-up banner, wall banner or grave cover, then personalise the details."
      products={getRegistryProducts(registry).filter(
        (product) => product.active && product.category === "banners",
      )}
    />
  );
}
