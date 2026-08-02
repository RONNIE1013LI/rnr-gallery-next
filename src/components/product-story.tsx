import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/domain/catalogue/types";
import { formatNzd } from "@/domain/money";
import styles from "./storefront.module.css";

type ProductStoryProps = Readonly<{
  product: Product;
  eyebrow: string;
  ctaLabel: string;
  mediaFirst?: boolean;
}>;

export function ProductStory({
  product,
  eyebrow,
  ctaLabel,
  mediaFirst = false,
}: ProductStoryProps) {
  return (
    <section className={`${styles.story} ${mediaFirst ? styles.storyMediaFirst : ""}`}>
      <div className={styles.storyCopy}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h2>{product.title}</h2>
        <p className={styles.storyLead}>{product.summary}</p>
        <ul className={styles.checkList}>
          <li>Personalised around your photos and wording</li>
          <li>Draft prepared for your review before production</li>
          <li>Designed and produced with care in New Zealand</li>
        </ul>
        <p className={styles.storyPrice}>
          From {formatNzd(product.startingPriceExGstCents)} + GST
        </p>
        <Link className={styles.primaryButton} href={`/products/${product.slug}`}>
          {ctaLabel}
        </Link>
      </div>
      <div className={styles.storyMedia}>
        <Image
          src={product.image.src}
          alt={product.image.alt}
          fill
          sizes="(max-width: 820px) 100vw, 55vw"
        />
      </div>
    </section>
  );
}
