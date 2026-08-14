import { notFound, permanentRedirect } from "next/navigation";
import { products } from "@/domain/catalogue/products";
import { getRegistryProductBySlug } from "@/domain/catalogue/product-registry";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import type { ProductPageProps } from "@/app/products/[slug]/page-content";
import { buildLegacyProductUrl } from "@/server/seo/legacy-product-url";

export const dynamicParams = false;
export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return products.map((product) => ({ slug: product.slug }));
}

export default async function LegacyProductPage({ params, searchParams }: ProductPageProps) {
  const [resolvedParams, resolvedSearchParams, { registry }] = await Promise.all([
    params,
    searchParams,
    getSafePublicProductRegistry(),
  ]);
  const product = getRegistryProductBySlug(registry, resolvedParams.slug);
  if (!product) notFound();
  permanentRedirect(buildLegacyProductUrl(product.slug, resolvedSearchParams));
}
