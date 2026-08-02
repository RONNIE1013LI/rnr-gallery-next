import type { Metadata } from "next";
import { CataloguePage } from "@/components/catalogue-page";
import { products } from "@/domain/catalogue/products";

export const metadata: Metadata = { title: "Design gallery" };

export default function DesignGalleryPage() {
  return (
    <CataloguePage
      eyebrow="Design gallery"
      title="Find the format for what you want to say."
      description="A curated view of the canvas and banner formats available in the new R&R Gallery. Individual design filtering and artwork records will be added in the gallery phase."
      products={products}
    />
  );
}
