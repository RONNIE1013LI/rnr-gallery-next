import Image from "next/image";
import Link from "next/link";
import { getRegistryProductBySlug, type ProductRegistryDocument } from "@/domain/catalogue/product-registry";
import { buildPublicDesignSlug, publicDesignTitle } from "@/domain/gallery/public-design-slug";
import type { Market } from "@/domain/markets/types";
import { getMarketStartingPriceInclTaxCents } from "@/domain/pricing/market-quote";
import { occasionLandingPages, type OccasionLandingContent } from "@/domain/seo/occasion-landing-pages";
import type { PublicGalleryItem } from "@/server/gallery/public-gallery-service";
import { buildBreadcrumbData } from "@/server/seo/metadata";
import { OccasionArtworkModel } from "./occasion-artwork-model";
import { ProductCard } from "./product-card";
import { PurchaseTrustStrip } from "./purchase-trust-strip";
import { StructuredData } from "./structured-data";
import styles from "./storefront.module.css";
import landing from "./occasion-landing-page.module.css";

export function OccasionLandingPage({ content, registry, market, artwork, artworkUnavailable = false }: Readonly<{
  content: OccasionLandingContent;
  registry: ProductRegistryDocument;
  market: Market;
  artwork: readonly PublicGalleryItem[];
  artworkUnavailable?: boolean;
}>) {
  const products = content.productSlugs.flatMap((slug) => {
    const product = getRegistryProductBySlug(registry, slug);
    return product?.active ? [product] : [];
  });
  const productPrefix = market === "AU" ? "/au/products" : "/products";
  const ctaHref = products[0] ? `${productPrefix}/${products[0].slug}` : "/contact";
  const breadcrumbs = [
    { name: "Home", path: market === "AU" ? "/au" : "/" },
    ...(content.parent ? [{ name: occasionLandingPages[content.parent].label, path: occasionLandingPages[content.parent].path }] : []),
    { name: content.label, path: content.path },
  ];
  return (
    <main id="main-content" className={`${styles.galleryPage} ${landing.page}`}>
      <StructuredData id="rnr-occasion-breadcrumbs" data={buildBreadcrumbData(breadcrumbs)} />
      <nav className={styles.publicBreadcrumbs} aria-label="Breadcrumb">
        {breadcrumbs.map((entry, index) => <span key={entry.path}>
          {index > 0 ? <span aria-hidden="true"> / </span> : null}
          {index === breadcrumbs.length - 1 ? <span aria-current="page">{entry.name}</span> : <Link href={entry.path}>{entry.name}</Link>}
        </span>)}
      </nav>
      <header className={styles.galleryIntro}>
        <h1>{content.heading}</h1>
        <p>{content.introduction}</p>
        <div className={styles.heroActions}>
          <Link className={styles.primaryButton} href={ctaHref}>{content.cta}</Link>
          <Link className={styles.secondaryButton} href="#artwork">Explore Designs</Link>
        </div>
      </header>

      <section id="artwork" className={landing.artwork} aria-labelledby="artwork-heading">
        <div className={styles.sectionHeading}><h2 id="artwork-heading">{content.artworkHeading}</h2></div>
        {content.artworkNote ? <p className={landing.note}>{content.artworkNote}</p> : null}
        {artwork.length ? <div className={styles.galleryGrid}>
          {artwork.map((item) => {
            const title = publicDesignTitle(item);
            const wide = item.productTypeSlug === "wall-hanging-banners";
            return <article key={item.id} className={styles.galleryCard} data-gallery-mobile-span={wide ? "wide" : "compact"}>
              <Link className={styles.galleryCardLink} href={`/designs/${buildPublicDesignSlug(title, item.id)}`}>
                <div className={styles.galleryCardMedia}>
                  <OccasionArtworkModel item={item}><Image src={`/gallery-images/${item.id}?v=${item.contentHash}`} alt={item.altText} width={item.width} height={item.height} loading="lazy"
                    sizes={wide ? "(max-width: 767px) 92vw, (max-width: 1179px) 45vw, (max-width: 1567px) 29.34vw, 459px" : "(max-width: 560px) calc((100vw - 3.25rem) / 2), (max-width: 767px) calc(46vw - 0.375rem), (max-width: 1179px) 45vw, (max-width: 1567px) 29.34vw, 459px"} /></OccasionArtworkModel>
                  <span className={styles.galleryCardBadge}>{title}</span>
                </div>
                <div className={styles.galleryCardBody}>
                  <h3 className={landing.cardTitle}>{title}</h3>
                  <span className={styles.galleryCardAction}>View Design</span>
                </div>
              </Link>
            </article>;
          })}
        </div> : <p className={landing.note}>{artworkUnavailable ? "Design examples are temporarily unavailable. You can still explore the banner formats below or contact the team." : "There are no published examples available for this selection right now. Explore the formats below and share your own design brief."}</p>}
        <Link className={styles.secondaryButton} href="/design-gallery">Explore the Design Gallery</Link>
      </section>

      <section className={landing.formats} aria-labelledby="formats-heading">
        <div className={styles.sectionHeading}><h2 id="formats-heading">Choose your display format</h2></div>
        <div className={`${styles.heroActions} ${landing.actions}`}>{products.map((product) =>
          <Link key={product.slug} className={styles.secondaryButton} href={`${productPrefix}/${product.slug}`}>{product.title} details</Link>,
        )}</div>
        <div className={styles.productGrid}>{products.map((product) =>
          <ProductCard key={product.slug} product={product} market={market} priceInclTaxCents={getMarketStartingPriceInclTaxCents(registry, market, product.key)} />,
        )}</div>
      </section>
      <section className={styles.adLandingSection}>
        <h2 className={landing.sectionTitle}>{content.guidanceHeading}</h2>
        <div>{content.guidance.map((paragraph) => <p className={landing.paragraph} key={paragraph}>{paragraph}</p>)}</div>
      </section>
      <section className={styles.adLandingSection}>
        <div><h2 className={landing.sectionTitle}>From your photos to a finished display</h2><PurchaseTrustStrip /></div>
        <div>
          <ol>
            <li><strong>Choose and personalise</strong><span>Select a format and supply your photos, wording and design details.</span></li>
            <li><strong>Review your artwork</strong><span>The team prepares your design for you to check. Approve the proof before printing.</span></li>
            <li><strong>Printing and delivery</strong><span>Your approved artwork is printed and prepared for delivery.</span></li>
          </ol>
          <p className={landing.paragraph}><Link href="/how-it-works">How it works</Link> · <Link href="/shipping-delivery">Production and delivery information</Link> · <Link href="/contact">Ask the team</Link></p>
        </div>
      </section>
      <section className={styles.adLandingFaq} aria-labelledby="faq-heading">
        <h2 className={landing.sectionTitle} id="faq-heading">{content.label}: your questions</h2>
        {content.faq.map((item) => <details key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}
      </section>
    </main>
  );
}
