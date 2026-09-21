import Link from "next/link";
import type { ReactNode } from "react";
import type { Product } from "@/domain/catalogue/types";
import { buildItemListEvent } from "@/domain/analytics/events";
import type { Market } from "@/domain/markets/types";
import { currencyForMarket } from "@/domain/markets/market";
import { addNzdGst } from "@/domain/money";
import { buildBreadcrumbData } from "@/server/seo/metadata";
import { ProductCard } from "./product-card";
import { AnalyticsEventTracker } from "./analytics-event-tracker";
import { StructuredData } from "./structured-data";
import styles from "./storefront.module.css";
import guideStyles from "./catalogue-seo.module.css";

type CataloguePageProps = Readonly<{
  eyebrow: string;
  title: string;
  description: string;
  path?: string;
  breadcrumbLabel?: string;
  products: readonly Product[];
  market?: Market;
  pricesInclTaxCents?: Readonly<Record<string, number>>;
  showProductDetailLinks?: boolean;
  children?: ReactNode;
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
  showProductDetailLinks = false,
  children,
}: CataloguePageProps) {
  const listId = `${market.toLowerCase()}:${path ?? (market === "AU" ? "/au/shop" : "/shop")}`;
  const analyticsItems = products.map((product, index) => ({
    productKey: product.key,
    productName: product.title,
    category: product.category,
    unitPriceCents: pricesInclTaxCents?.[product.key]
      ?? addNzdGst(product.startingPriceExGstCents),
    index,
  }));
  const listEventInput = {
    listId,
    listName: title,
    currency: currencyForMarket(market),
    items: analyticsItems,
  } as const;

  return (
    <main id="main-content" className={`${styles.pageMain} ${styles.catalogueMain}`}>
      <AnalyticsEventTracker
        event={buildItemListEvent("view_item_list", listEventInput)}
        scopeKey={listId}
      />
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
      </header>
      <nav className={`${styles.galleryQuickFilters} ${styles.catalogueLinks}`} aria-label="Browse artwork categories">
        <Link href="/design-gallery">All Designs</Link>
        <Link href="/design-gallery?occasion=memorial">Memorial</Link>
        <Link href="/design-gallery?occasion=birthday">Birthday</Link>
        <Link href="/design-gallery?occasion=family-portrait">Family</Link>
        <Link href="/design-gallery?occasion=wedding">Wedding</Link>
        <Link href="/design-gallery?occasion=religious">Religious</Link>
        <Link href={market === "AU" ? "/au/canvas" : "/canvas"} aria-current={path?.endsWith("/canvas") ? "page" : undefined}>Canvas</Link>
        <Link href={market === "AU" ? "/au/banners" : "/banners"} aria-current={path?.endsWith("/banners") ? "page" : undefined}>Banners</Link>
      </nav>
      <section className={styles.productGrid} aria-label={`${title} products`}>
        {products.map((product, index) => (
          <ProductCard
            key={product.key}
            product={product}
            priority={index === 0}
            market={market}
            priceInclTaxCents={pricesInclTaxCents?.[product.key]}
            selectionEvent={buildItemListEvent("select_item", {
              ...listEventInput,
              items: [analyticsItems[index]],
            })}
          />
        ))}
      </section>
      {showProductDetailLinks && products.length ? (
        <section className={guideStyles.section} aria-labelledby="catalogue-product-information">
          <h2 id="catalogue-product-information">Explore product details</h2>
          <p>Compare the artwork options before starting your design.</p>
          <nav aria-label="Product information">
            <ul className={guideStyles.productLinks}>
              {products.map((product) => (
                <li key={product.key}>
                  <Link
                    href={`${market === "AU" ? "/au" : ""}/products/${product.slug}`}
                    prefetch={false}
                  >
                    {product.title} details
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </section>
      ) : null}
      {children}
    </main>
  );
}
