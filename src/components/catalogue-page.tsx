import type { Product } from "@/domain/catalogue/types";
import { ProductCard } from "./product-card";
import styles from "./storefront.module.css";

type CataloguePageProps = Readonly<{
  eyebrow: string;
  title: string;
  description: string;
  products: readonly Product[];
}>;

export function CataloguePage({
  eyebrow,
  title,
  description,
  products,
}: CataloguePageProps) {
  return (
    <main id="main-content" className={styles.pageMain}>
      <header className={styles.pageIntro}>
        {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </header>
      <section className={styles.productGrid} aria-label={`${title} products`}>
        {products.map((product, index) => (
          <ProductCard key={product.key} product={product} priority={index === 0} />
        ))}
      </section>
    </main>
  );
}
