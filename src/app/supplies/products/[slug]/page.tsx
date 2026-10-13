import { notFound } from "next/navigation";
import { SupplyProductDetail } from "@/components/supplies-storefront";
import { StructuredData } from "@/components/structured-data";
import { getPublicSuppliesCatalogue } from "@/server/supplies/catalogue";
import { absoluteSiteUrl, buildPublicMetadata } from "@/server/seo/metadata";
import { supplyProductDisplayDto } from "../../display-dto";

export const dynamic = "force-dynamic";
type Props = Readonly<{ params: Promise<{ slug: string }> }>;

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const catalogue = await getPublicSuppliesCatalogue();
  const product = catalogue?.products.find((item) => item.slug === slug);
  if (!product) return { robots: { index: false, follow: false } };
  const cover = product.images.find((item) => item.isCover) ?? product.images[0];
  return buildPublicMetadata({ title: product.seoTitle || product.title, description: product.seoDescription || product.shortDescription || `Shop ${product.title} from R&R Gallery.`, path: `/supplies/products/${product.slug}`, image: cover?.url ?? "/media/brand/rr-gallery-logo-2026.webp", imageAlt: cover?.altText || product.title });
}

export default async function SupplyProductPage({ params }: Props) {
  const { slug } = await params;
  const catalogue = await getPublicSuppliesCatalogue();
  const product = catalogue?.products.find((item) => item.slug === slug);
  if (!catalogue || !product) notFound();
  const category = catalogue.categories.find((item) => item.id === product.categoryId);
  const selections = product.variants.length ? product.variants : [product];
  const offers = selections.filter((item) => (item.salePriceCents ?? item.priceCents) > 0).map((item) => ({
    "@type": "Offer", priceCurrency: "NZD", price: ((item.salePriceCents ?? item.priceCents) / 100).toFixed(2),
    sku: item.sku, url: absoluteSiteUrl(`/supplies/products/${product.slug}`),
    availability: product.available && item.available && (!item.trackInventory || (item.stockQuantity ?? 0) > 0)
      ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    eligibleRegion: "NZ",
  }));
  return <><StructuredData id="supplies-product" data={{ "@context": "https://schema.org", "@type": "Product", name: product.title, description: product.shortDescription, sku: product.sku, image: product.images.map((item) => absoluteSiteUrl(item.url)), ...(offers.length ? { offers } : {}) }} /><SupplyProductDetail product={supplyProductDisplayDto(product)} categoryName={category?.name ?? "Supplies"} /></>;
}
