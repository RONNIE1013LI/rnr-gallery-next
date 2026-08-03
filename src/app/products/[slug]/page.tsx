import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import styles from "@/components/storefront.module.css";
import { getProductBySlug, products } from "@/domain/catalogue/products";
import { formatNzd } from "@/domain/money";
import type { Product } from "@/domain/catalogue/types";
import type { GalleryDesignSelection } from "@/server/gallery/design-selection-service";
import { getGalleryRuntime } from "@/server/gallery/gallery-runtime";

type ProductPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ design?: string | string[] }>;
};

export const dynamicParams = false;

export function generateStaticParams() {
  return products.map((product) => ({ slug: product.slug }));
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const product = getProductBySlug((await params).slug);
  return product
    ? { title: product.title, description: product.summary }
    : { title: "Product not found" };
}

export function ProductPageContent({
  product,
  selection,
}: Readonly<{ product: Product; selection: GalleryDesignSelection | null }>) {
  const configureHref = selection
    ? `/products/${product.slug}/configure?design=${selection.id}`
    : `/products/${product.slug}/configure`;
  return (
    <main id="main-content" className={styles.productDetail}>
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
            From {formatNzd(product.startingPriceExGstCents)} + GST
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
    </main>
  );
}

export default async function ProductPage({ params, searchParams }: ProductPageProps) {
  const product = getProductBySlug((await params).slug);
  if (!product) notFound();
  const rawDesign = (await searchParams).design;
  const designId = Array.isArray(rawDesign) ? rawDesign[0] : rawDesign;
  let selection: GalleryDesignSelection | null = null;
  try {
    selection = await getGalleryRuntime().selectionService.resolve(designId, product.slug);
  } catch {
    selection = null;
  }
  return <ProductPageContent product={product} selection={selection} />;
}
