import Link from "next/link";
import type { Product } from "@/domain/catalogue/types";
import type { Market } from "@/domain/markets/types";
import { buildBreadcrumbData } from "@/server/seo/metadata";
import { ProductCard } from "./product-card";
import { StructuredData } from "./structured-data";
import styles from "./storefront.module.css";

type CataloguePageProps = Readonly<{
  eyebrow: string;
  title: string;
  description: string;
  path?: string;
  breadcrumbLabel?: string;
  products: readonly Product[];
  market?: Market;
  pricesInclTaxCents?: Readonly<Record<string, number>>;
  relatedLinks?: readonly Readonly<{ href: string; label: string }>[];
}>;

export function CataloguePage({
  eyebrow,
  title,
  description,
  path,
  breadcrumbLabel,
  products,
  market = "NZ",
  pricesInclTaxCents,
  relatedLinks = [],
}: CataloguePageProps) {
  return (
    <main id="main-content" className={styles.pageMain}>
      {path && breadcrumbLabel ? (
        <StructuredData id="rnr-catalogue-breadcrumbs" data={buildBreadcrumbData([
          { name: "Home", path: "/" },
          { name: breadcrumbLabel, path },
        ])} />
      ) : null}
      <header className={styles.pageIntro}>
        {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className={styles.pageIntroDescription}>{description}</p> : null}
        {relatedLinks.length > 0 ? (
          <nav className={styles.pageIntroLinks} aria-label="Product guides">
            {relatedLinks.map((link) => (
              <Link href={link.href} key={link.href}>{link.label}</Link>
            ))}
          </nav>
        ) : null}
      </header>
      <section className={styles.productGrid} aria-label={`${title} products`}>
        {products.map((product, index) => (
          <ProductCard
            key={product.key}
            product={product}
            priority={index === 0}
            market={market}
            priceInclTaxCents={pricesInclTaxCents?.[product.key]}
          />
        ))}
      </section>
    </main>
  );
}
