import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AustraliaUnavailable } from "@/components/market-unavailable";
import { getMarketCompleteness } from "@/domain/catalogue/market-price-book";
import {
  getRegistryProductBySlug,
  schemaFromRegistry,
} from "@/domain/catalogue/product-registry";
import {
  quoteMarketConfiguration,
} from "@/domain/pricing/market-quote";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import { buildPublicMetadata } from "@/server/seo/metadata";
import {
  ProductPageContent,
  resolveProductPageSearchSelection,
  resolveRequestedSizeKey,
  type ProductPageProps,
} from "@/app/products/[slug]/page-content";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { registry } = await getSafePublicProductRegistry();
  const product = getRegistryProductBySlug(registry, (await params).slug);
  if (!product) return { title: "Product not found", robots: { index: false, follow: false } };
  if (!registry.markets.AU.enabled || !getMarketCompleteness(registry, "AU").ready) {
    return {
      title: `${product.title} for Australia — not available yet`,
      robots: { index: false, follow: false },
    };
  }
  return buildPublicMetadata({
    title: `${product.title} Australia`,
    description: `${product.summary} Fixed Australian pricing in AUD.`,
    path: `/au/products/${product.slug}`,
    image: product.image.src,
    imageAlt: product.image.alt,
    includeMarketAlternates: true,
  });
}

export default async function AustraliaProductPage({ params, searchParams }: ProductPageProps) {
  const { registry } = await getSafePublicProductRegistry();
  const product = getRegistryProductBySlug(registry, (await params).slug);
  if (!product) notFound();
  if (!registry.markets.AU.enabled || !getMarketCompleteness(registry, "AU").ready) {
    return <AustraliaUnavailable />;
  }
  const { selection } = await resolveProductPageSearchSelection(product.slug, searchParams);
  const resolvedSearchParams = await searchParams;
  const selectedSizeKey = resolveRequestedSizeKey(
    registry,
    product.key,
    resolvedSearchParams.size,
  );
  const schema = schemaFromRegistry(registry, product.key);
  if (!schema) notFound();
  const analyticsSizeKey = selectedSizeKey ?? schema.defaultSizeKey;
  const quote = quoteMarketConfiguration(registry, "AU", product.key, {
    sizeKey: analyticsSizeKey,
    peoplePets: schema.defaultPeoplePets,
  });
  return (
    <ProductPageContent
      product={product}
      selection={selection}
      market="AU"
      priceInclTaxCents={quote.totalInclGstCents}
      analyticsSubtotalExGstCents={quote.subtotalExGstCents}
      analyticsSizeKey={analyticsSizeKey}
      taxRegistered={registry.markets.AU.tax.registered}
      selectedSizeKey={selectedSizeKey}
      sizeLabels={schema.sizes.map((size) => size.label)}
    />
  );
}
