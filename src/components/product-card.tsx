import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/domain/catalogue/types";
import { addNzdGst, formatNzd } from "@/domain/money";
import styles from "./storefront.module.css";

export function ProductCard({
  product,
  priority = false,
}: Readonly<{ product: Product; priority?: boolean }>) {
  const configureHref = `/products/${product.slug}/configure`;

  return (
    <article className={styles.productCard}>
      <Link className={styles.productCardLink} href={configureHref}>
        <div className={styles.productCardMedia}>
          <Image
            src={product.image.src}
            alt={product.image.alt}
            fill
            priority={priority}
            loading={priority ? "eager" : undefined}
            fetchPriority={priority ? "high" : undefined}
            sizes="(max-width: 560px) calc(100vw - 2.5rem - 2px), (max-width: 650px) calc(92vw - 2px), (max-width: 1100px) calc(44.75vw - 2px), (max-width: 1363px) calc(29vw - 2px), (max-width: 1567px) calc(21.125vw - 2px), 328px"
          />
        </div>
        <div className={styles.productCardBody}>
          <p className={styles.productCategory}>{product.category}</p>
          <h2>{product.title}</h2>
          <p>{product.summary}</p>
          <div className={styles.productCardFooter}>
            <span className={styles.publicPrice}>
              <strong>From {formatNzd(addNzdGst(product.startingPriceExGstCents))} incl GST</strong>
            </span>
            <span className={styles.primaryButton}>Create Your Artwork</span>
          </div>
        </div>
      </Link>
    </article>
  );
}
