import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/domain/catalogue/types";
import styles from "./storefront.module.css";

type ProductStoryProps = Readonly<{
  product: Product;
  ctaLabel: string;
  ctaHref?: string;
  copy?: Readonly<{
    title: string;
    summary: string;
    features: readonly string[];
  }>;
  mediaFirst?: boolean;
}>;

export function ProductStory({
  product,
  ctaLabel,
  ctaHref,
  copy,
  mediaFirst = false,
}: ProductStoryProps) {
  const storyCopy =
    copy ??
    ({
      title: product.title,
      summary: product.summary,
      features: [
        "Personalised around your photos and wording",
        "Draft prepared for your review before production",
        "Designed and produced with care in New Zealand",
      ],
    } as const);

  return (
    <section
      className={`${styles.story} ${mediaFirst ? styles.storyMediaFirst : ""}`}
      aria-label={`${storyCopy.title} details`}
    >
      <div className={styles.storyCopy}>
        <h2>{storyCopy.title}</h2>
        <p className={styles.storyLead}>{storyCopy.summary}</p>
        <ul className={styles.checkList}>
          {storyCopy.features.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
        <Link className={styles.primaryButton} href={ctaHref ?? `/products/${product.slug}`}>
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
