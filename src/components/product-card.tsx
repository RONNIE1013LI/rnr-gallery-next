import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/domain/catalogue/types";
import type { Market } from "@/domain/markets/types";
import { currencyForMarket } from "@/domain/markets/market";
import { addNzdGst, formatMarketMoney } from "@/domain/money";
import styles from "./storefront.module.css";

export function ProductCard({
  product,
  priority = false,
  market = "NZ",
  priceInclTaxCents,
}: Readonly<{
  product: Product;
  priority?: boolean;
  market?: Market;
  priceInclTaxCents?: number;
}>) {
  const destination = market === "AU"
    ? `/au/products/${product.slug}/configure`
    : `/products/${product.slug}/configure`;
  const displayPrice = priceInclTaxCents ?? addNzdGst(product.startingPriceExGstCents);
  const taxLabel = market === "NZ" ? " incl GST" : "";

  return (
    <article className={styles.productCard}>
      <Link className={styles.productCardLink} href={destination}>
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
              <strong>From {formatMarketMoney(displayPrice, currencyForMarket(market))}{taxLabel}</strong>
            </span>
            <span className={styles.primaryButton}>Create Your Artwork</span>
          </div>
        </div>
      </Link>
    </article>
  );
}
