import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ProductConfiguratorRelatedDesign } from "@/components/product-configurator";
import {
  getRegistryProductBySlug,
  schemaFromRegistry,
} from "@/domain/catalogue/product-registry";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import type { GalleryDesignSelection } from "@/server/gallery/design-selection-service";
import { getGalleryRuntime } from "@/server/gallery/gallery-runtime";
import { ConfigurePageContent } from "./page-content";

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

async function getProductDesigns(slug: string): Promise<readonly ProductConfiguratorRelatedDesign[]> {
  const runtime = getGalleryRuntime();
  const candidates = await runtime.repository.listActiveCandidates();
  const relevant = await Promise.all(
    candidates
      .filter((candidate) => candidate.productSlug === slug)
      .map(async (candidate) => {
        const isAvailable = await runtime.store.isAvailable(candidate.storageKey);
        if (!isAvailable) return null;
        return {
          id: candidate.id,
          altText: candidate.altText,
          imageUrl: `/gallery-images/${candidate.id}?v=${candidate.contentHash}`,
          width: candidate.width,
          height: candidate.height,
          title: candidate.subOccasion ?? candidate.altText,
          productSlug: candidate.productSlug,
        } as ProductConfiguratorRelatedDesign;
      }),
  );

  return Object.freeze(relevant.filter((item): item is ProductConfiguratorRelatedDesign => item !== null).slice(0, 8));
}

export async function generateMetadata({ params }: ConfigurePageProps): Promise<Metadata> {
  const { registry } = await getSafePublicProductRegistry();
  const product = getRegistryProductBySlug(registry, (await params).slug);
  return {
    title: product ? `Create ${product.title}` : "Product not found",
    robots: { index: false, follow: false },
  };
}

export default async function ConfigurePage({ params, searchParams }: ConfigurePageProps) {
  const { registry } = await getSafePublicProductRegistry();
  const product = getRegistryProductBySlug(registry, (await params).slug);
  if (!product) notFound();
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

  let relatedDesigns: readonly ProductConfiguratorRelatedDesign[] = [];
  try {
    relatedDesigns = await getProductDesigns(product.slug);
  } catch {
    relatedDesigns = [];
  }

  return <ConfigurePageContent
    product={product}
    schema={schema}
    pricing={registry.pricing}
    registry={registry}
    market="NZ"
    orderDate={getAucklandOrderDate()}
    selectedDesign={selectedDesign}
    relatedDesigns={relatedDesigns}
  />;
}
