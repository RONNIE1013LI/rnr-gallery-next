import type { Metadata } from "next";
import { CataloguePage } from "@/components/catalogue-page";
import { getProductsByCategory } from "@/domain/catalogue/products";

export const metadata: Metadata = { title: "Custom banners" };

export default function BannersPage() {
  return (
    <CataloguePage
      eyebrow="Banner collection"
      title="A meaningful presence at any scale."
      description="Portable roll-up displays, wall banners, painterly banner artwork and memorial grave covers for events and lasting tributes."
      products={getProductsByCategory("banners")}
    />
  );
}
