import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/domain/catalogue/types";
import { formatNzd } from "@/domain/money";
import styles from "./storefront.module.css";

export function ProductCard({ product }: { product: Product }) {
  return (
    <article className={styles.productCard}>
      <div className={styles.productCardMedia}>
        <Image
          src={product.image.src}
          alt={product.image.alt}
          fill
          sizes="(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw"
        />
      </div>
      <div className={styles.productCardBody}>
        <p className={styles.eyebrow}>{product.category}</p>
        <h2>{product.title}</h2>
        <p>{product.summary}</p>
        <div className={styles.productCardFooter}>
          <span>From {formatNzd(product.startingPriceExGstCents)} + GST</span>
          <Link href={`/products/${product.slug}`}>View product</Link>
        </div>
      </div>
    </article>
  );
}
