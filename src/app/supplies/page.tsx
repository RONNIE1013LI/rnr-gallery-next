import { notFound } from "next/navigation";
import { SuppliesStorefront } from "@/components/supplies-storefront";
import { getPublicSuppliesCatalogue } from "@/server/supplies/catalogue";
import { buildPublicMetadata } from "@/server/seo/metadata";
import { suppliesDisplayDto } from "./display-dto";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const catalogue = await getPublicSuppliesCatalogue();
  if (!catalogue) return { robots: { index: false, follow: false } };
  return buildPublicMetadata({ title: "Canvas & Display Supplies", description: "Shop canvas materials, stretcher bars and display hardware in New Zealand. NZD prices including GST.", path: "/supplies", image: "/media/brand/rr-gallery-logo-2026.webp", imageAlt: "R&R Gallery" });
}

export default async function SuppliesPage() {
  const catalogue = await getPublicSuppliesCatalogue();
  if (!catalogue) notFound();
  return <SuppliesStorefront catalogue={suppliesDisplayDto(catalogue)} />;
}
