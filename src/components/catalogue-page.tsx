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
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      <section className={styles.productGrid} aria-label={`${title} products`}>
        {products.map((product) => (
          <ProductCard key={product.key} product={product} />
        ))}
      </section>
    </main>
  );
}
