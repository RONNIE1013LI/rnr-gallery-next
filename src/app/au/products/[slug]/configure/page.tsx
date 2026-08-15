import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AustraliaUnavailable } from "@/components/market-unavailable";
import { getMarketCompleteness } from "@/domain/catalogue/market-price-book";
import {
  getRegistryProductBySlug,
  schemaFromRegistry,
} from "@/domain/catalogue/product-registry";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import { getGalleryRuntime } from "@/server/gallery/gallery-runtime";
import type { GalleryDesignSelection } from "@/server/gallery/design-selection-service";
import { ConfigurePageContent } from "@/app/products/[slug]/configure/page-content";

type ConfigurePageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ design?: string | string[] }>;
};

export const dynamic = "force-dynamic";

function getAucklandOrderDate(): string {
  const parts = new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export async function generateMetadata({ params }: ConfigurePageProps): Promise<Metadata> {
  const { registry } = await getSafePublicProductRegistry();
  const product = getRegistryProductBySlug(registry, (await params).slug);
  return {
    title: product ? `Create ${product.title} for Australia` : "Product not found",
    robots: { index: false, follow: false },
  };
}

export default async function AustraliaConfigurePage({ params, searchParams }: ConfigurePageProps) {
  const { registry } = await getSafePublicProductRegistry();
  const product = getRegistryProductBySlug(registry, (await params).slug);
  if (!product) notFound();
  if (!registry.markets.AU.enabled || !getMarketCompleteness(registry, "AU").ready) {
    return <AustraliaUnavailable />;
  }
  const schema = schemaFromRegistry(registry, product.key);
  if (!schema) notFound();
  const rawDesign = (await searchParams).design;
  const designId = Array.isArray(rawDesign) ? rawDesign[0] : rawDesign;
  let selectedDesign: GalleryDesignSelection | null = null;
  try {
    selectedDesign = await getGalleryRuntime().selectionService.resolve(designId, product.slug);
  } catch {
    selectedDesign = null;
  }
  return (
    <ConfigurePageContent
      product={product}
      schema={schema}
      pricing={registry.pricing}
      registry={registry}
      market="AU"
      orderDate={getAucklandOrderDate()}
      selectedDesign={selectedDesign}
      relatedDesigns={[]}
    />
  );
}
