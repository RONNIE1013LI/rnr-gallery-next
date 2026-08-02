import type { Metadata } from "next";
import { CataloguePage } from "@/components/catalogue-page";
import { products } from "@/domain/catalogue/products";

export const metadata: Metadata = { title: "Shop custom artwork" };

export default function ShopPage() {
  return (
    <CataloguePage
      eyebrow="The complete range"
      title="Choose the format for your story."
      description="Canvas, portable displays and large-format banners, each personalised around your photos and wording. Prices shown exclude GST."
      products={products}
    />
  );
}
