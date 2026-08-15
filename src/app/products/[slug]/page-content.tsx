import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { FacebookReviews } from "@/components/facebook-reviews";
import { StructuredData } from "@/components/structured-data";
import { notFound } from "next/navigation";
import styles from "@/components/storefront.module.css";
import { products } from "@/domain/catalogue/products";
import { getRegistryProductBySlug } from "@/domain/catalogue/product-registry";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import { addNzdGst, formatNzdExplicit } from "@/domain/money";
import type { Product } from "@/domain/catalogue/types";
import type { GalleryDesignSelection } from "@/server/gallery/design-selection-service";
import { getGalleryRuntime } from "@/server/gallery/gallery-runtime";
import { getSiteUrl } from "@/server/seo/site-url";
import { buildBreadcrumbData, buildPublicMetadata } from "@/server/seo/metadata";

export type ProductPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    design?: string | string[];
    reviews?: string | string[];
    rnr_design?: string | string[];
  }>;
};

export const dynamicParams = false;
export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return products.map((product) => ({ slug: product.slug }));
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { registry } = await getSafePublicProductRegistry();
  const product = getRegistryProductBySlug(registry, (await params).slug);
  return product
    ? buildPublicMetadata({
        title: product.title,
        description: product.summary,
        path: `/products/${product.slug}`,
        image: product.image.src,
        imageAlt: product.image.alt,
      })
    : { title: "Product not found" };
}

export function ProductPageContent({
  product,
  selection,
  reviewPage = 1,
}: Readonly<{
  product: Product;
  selection: GalleryDesignSelection | null;
  reviewPage?: number;
}>) {
  const configureHref = selection
    ? `/products/${product.slug}/configure?design=${selection.id}`
    : `/products/${product.slug}/configure`;
  const siteUrl = getSiteUrl();
  const productUrl = new URL(`/products/${product.slug}`, siteUrl).toString();
  const imageUrl = new URL(selection?.imageUrl ?? product.image.src, siteUrl).toString();
  const priceInclGstCents = addNzdGst(product.startingPriceExGstCents);
  const priceInclGst = (priceInclGstCents / 100).toFixed(2);
  return (
    <main id="main-content" className={styles.productDetail}>
      <StructuredData id="rnr-product-data" data={{
        "@context": "https://schema.org",
        "@type": "Product",
        name: product.title,
        description: product.summary,
        image: [imageUrl],
        brand: { "@type": "Brand", name: "R&R Gallery" },
        offers: {
          "@type": "Offer",
          url: productUrl,
          priceCurrency: "NZD",
          price: priceInclGst,
          availability: "https://schema.org/InStock",
          itemCondition: "https://schema.org/NewCondition",
        },
      }} />
      <StructuredData id="rnr-product-breadcrumbs" data={buildBreadcrumbData([
        { name: "Home", path: "/" },
        { name: "Shop", path: "/shop" },
        { name: product.title, path: `/products/${product.slug}` },
      ])} />
      <div className={styles.productDetailInner}>
        <div className={styles.productDetailMedia}>
          <Image
            src={selection?.imageUrl ?? product.image.src}
            alt={selection?.altText ?? product.image.alt}
            fill
            loading="eager"
            priority
            sizes="(max-width: 820px) 100vw, 58vw"
            unoptimized={Boolean(selection)}
          />
        </div>
        <div className={styles.productDetailCopy}>
          <p className={styles.eyebrow}>{product.category}</p>
          <h1>{product.title}</h1>
          {selection && (
            <div className={styles.selectedDesignNote}>
              <strong>Selected design inspiration</strong>
              <span>{selection.title}</span>
            </div>
          )}
          <p className={styles.productDetailLead}>{product.summary}</p>
          <p className={styles.productDetailPrice}>
            From {formatNzdExplicit(priceInclGstCents)} incl GST
          </p>
          <ul className={styles.checkList}>
            <li>Choose the finished format and artwork details</li>
            <li>Upload now or provide your source photos after ordering</li>
            <li>Review a draft before production begins</li>
          </ul>
          <Link className={styles.primaryButton} href={configureHref}>
            Create your artwork
          </Link>
        </div>
      </div>
      <FacebookReviews
        compact
        page={reviewPage}
        pagePath={`/products/${product.slug}`}
      />
    </main>
  );
}

export async function resolveProductPageSearchSelection(productSlug: string, searchParams: ProductPageProps["searchParams"]) {
  const resolved = await searchParams;
  const rawDesign = resolved.design ?? resolved.rnr_design;
  const designId = Array.isArray(rawDesign) ? rawDesign[0] : rawDesign;
  let selection: GalleryDesignSelection | null = null;
  try {
    selection = await getGalleryRuntime().selectionService.resolve(designId, productSlug);
  } catch {
    selection = null;
  }
  return { selection, designId };
}

export default async function ProductPage({ params, searchParams }: ProductPageProps) {
  const { registry } = await getSafePublicProductRegistry();
  const product = getRegistryProductBySlug(registry, (await params).slug);
  if (!product) notFound();
  const { selection } = await resolveProductPageSearchSelection(product.slug, searchParams);
  const rawReviewPage = (await searchParams).reviews;
  const reviewPage = Number(Array.isArray(rawReviewPage) ? rawReviewPage[0] : rawReviewPage);
  return (
    <ProductPageContent
      product={product}
      reviewPage={Number.isInteger(reviewPage) ? reviewPage : 1}
      selection={selection}
    />
  );
}
