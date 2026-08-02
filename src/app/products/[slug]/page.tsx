import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import styles from "@/components/storefront.module.css";
import { getProductBySlug, products } from "@/domain/catalogue/products";
import { formatNzd } from "@/domain/money";

type ProductPageProps = {
  params: Promise<{ slug: string }>;
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

export default async function ProductPage({ params }: ProductPageProps) {
  const product = getProductBySlug((await params).slug);
  if (!product) notFound();

  return (
    <main id="main-content" className={styles.productDetail}>
      <div className={styles.productDetailInner}>
        <div className={styles.productDetailMedia}>
          <Image
            src={product.image.src}
            alt={product.image.alt}
            fill
            loading="eager"
            sizes="(max-width: 820px) 100vw, 58vw"
          />
        </div>
        <div className={styles.productDetailCopy}>
          <p className={styles.eyebrow}>{product.category}</p>
          <h1>{product.title}</h1>
          <p className={styles.productDetailLead}>{product.summary}</p>
          <p className={styles.productDetailPrice}>
            From {formatNzd(product.startingPriceExGstCents)} + GST
          </p>
          <ul className={styles.checkList}>
            <li>Choose the finished format and artwork details</li>
            <li>Upload now or provide your source photos after ordering</li>
            <li>Review a draft before production begins</li>
          </ul>
          <a
            className={styles.primaryButton}
            href="https://m.me/RandRgallery"
            rel="noopener noreferrer"
          >
            Discuss your artwork
          </a>
        </div>
      </div>
    </main>
  );
}
