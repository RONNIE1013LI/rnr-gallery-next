import type { Metadata } from "next";
import { CataloguePage } from "@/components/catalogue-page";
import { getProductsByCategory } from "@/domain/catalogue/products";

export const metadata: Metadata = { title: "Custom canvas" };

export default function CanvasPage() {
  return (
    <CataloguePage
      eyebrow="Canvas collection"
      title="Photos, made to live on your wall."
      description="Choose a direct photo print, a painterly portrait or a themed composition. Every canvas is prepared for its finished size and orientation."
      products={getProductsByCategory("canvas")}
    />
  );
}
