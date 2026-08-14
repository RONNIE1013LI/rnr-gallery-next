import type { Metadata } from "next";
import { CataloguePage } from "@/components/catalogue-page";
import { getRegistryProducts } from "@/domain/catalogue/product-registry";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";

export const metadata: Metadata = {
  title: "Shop custom artwork",
  description: "Choose personalised canvas, banner and print products made by R&R Gallery.",
  alternates: { canonical: "/shop" },
};
export const dynamic = "force-dynamic";

export default async function ShopPage() {
  const { registry } = await getSafePublicProductRegistry();
  return (
    <CataloguePage
      eyebrow="OUR PRODUCTS"
      title="Choose what you'd like us to create."
      description="Select a product to see sizes, options and start your personalised order."
      products={getRegistryProducts(registry).filter((product) => product.active)}
    />
  );
}
