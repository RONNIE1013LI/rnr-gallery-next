import { CataloguePage } from "@/components/catalogue-page";
import { getRegistryProducts } from "@/domain/catalogue/product-registry";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import { buildPublicMetadata } from "@/server/seo/metadata";

export const metadata = buildPublicMetadata({
  title: "Shop custom artwork",
  description: "Choose personalised canvas, banner and print products made by R&R Gallery.",
  path: "/shop",
  image: "/media/home/homepage-products-ink-sailboat.webp",
  imageAlt: "Selection of personalised R&R Gallery artwork products",
});
export const dynamic = "force-dynamic";

export default async function ShopPage() {
  const { registry } = await getSafePublicProductRegistry();
  return (
    <CataloguePage
      eyebrow="OUR PRODUCTS"
      title="Choose what you'd like us to create."
      description="Select a product to see sizes, options and start your personalised order."
      path="/shop"
      breadcrumbLabel="Shop"
      products={getRegistryProducts(registry).filter((product) => product.active)}
    />
  );
}
