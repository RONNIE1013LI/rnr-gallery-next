import Image from "next/image";
import Link from "next/link";
import { FacebookReviews } from "@/components/facebook-reviews";
import { ProductCard } from "@/components/product-card";
import { ProductStory } from "@/components/product-story";
import { StructuredData } from "@/components/structured-data";
import {
  defaultProductRegistry,
  getRegistryProductBySlug,
  getRegistryProducts,
  type ProductRegistryDocument,
} from "@/domain/catalogue/product-registry";
import { getSafePublicContent } from "@/server/admin/admin-content-runtime";
import { getSafePublicProductRegistry } from "@/server/admin/product-registry-runtime";
import styles from "@/components/storefront.module.css";
import { getSiteUrl } from "@/server/seo/site-url";

type HomeProps = Readonly<{
  searchParams: Promise<{ reviews?: string | string[] }>;
}>;

export type HomeHeroContent = Readonly<{
  eyebrow: string;
  title: string;
  subtitle: string;
  primaryCta: string;
  secondaryCta: string;
  processEyebrow?: string;
  processTitle?: string;
}>;

const defaultHeroContent: HomeHeroContent = Object.freeze({
  eyebrow: "Made around what matters",
  title: "Art made from your story.",
  subtitle:
    "Turn meaningful photos into personal canvas and banner artwork, created with care in New Zealand.",
  primaryCta: "Create your artwork",
  secondaryCta: "Explore the gallery",
  processEyebrow: "How it works",
  processTitle: "Simple steps. Personal results.",
});

export function HomeContent({
  reviewPage = 1,
  content = defaultHeroContent,
  registry = defaultProductRegistry,
}: Readonly<{
  reviewPage?: number;
  content?: HomeHeroContent;
  registry?: ProductRegistryDocument;
}>) {
  const digitalOil = getRegistryProductBySlug(registry, "digital-oil-painting-canvas");
  const rollUp = getRegistryProductBySlug(registry, "roll-up-banner");
  const wallBanner = getRegistryProductBySlug(registry, "custom-themed-wall-banner");
  const selectedWork = getRegistryProducts(registry).filter(
    (product) => product.active && [
        "photo-print-canvas",
        "digital-oil-painting-canvas",
        "roll-up-banner",
        "custom-themed-wall-banner",
      ].includes(product.slug),
  );

  return (
    <main id="main-content" className={styles.homePage}>
      <StructuredData id="rnr-local-business" data={{
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        name: "R&R Gallery",
        url: getSiteUrl().toString(),
        image: new URL("/media/home/digital-oil-painting-canvas-hero-landscape-01.webp", getSiteUrl()).toString(),
        email: "customerservice@rnrgallery.com",
        telephone: "+64 21 023 48948",
        address: {
          "@type": "PostalAddress",
          streetAddress: "11 Para Close",
          addressLocality: "Fairview Heights",
          addressRegion: "Auckland",
          postalCode: "0632",
          addressCountry: "NZ",
        },
        areaServed: ["New Zealand", "Australia"],
      }} />
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>{content.eyebrow}</p>
          <h1>{content.title}</h1>
          <p className={styles.heroLead}>{content.subtitle}</p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryButton} href="/shop">
              {content.primaryCta}
            </Link>
            <Link className={styles.secondaryButton} href="/design-gallery">
              {content.secondaryCta}
            </Link>
          </div>
        </div>
        <div className={styles.heroMedia}>
          <Image
            src="/media/home/digital-oil-painting-canvas-hero-landscape-01.webp"
            alt="Digital oil painting canvas displayed in a warm home interior"
            fill
            priority
            sizes="(max-width: 820px) 100vw, 60vw"
          />
        </div>
      </section>

      {digitalOil ? (
        <ProductStory
          product={digitalOil}
          ctaHref={`/products/${digitalOil.slug}/configure`}
          ctaLabel="Create Oil Painting Canvas"
          copy={{
            title: "Digital oil painting canvas",
            summary:
              "A painterly artwork created from your photo and printed on premium canvas.",
            features: [
              "Painterly finish from your photo",
              "Personalised composition and wording",
              "Draft prepared before printing",
            ],
          }}
        />
      ) : null}
      {rollUp ? (
        <ProductStory
          product={rollUp}
          ctaHref={`/products/${rollUp.slug}/configure`}
          ctaLabel="Create Roll-Up Banner"
          copy={{
            title: "Roll-up banner",
            summary:
              "A personalised roll-up display for memorial services, celebrations and promotional events.",
            features: [
              "Custom design and an 85 × 200 cm printed banner",
              "Stand, carry bag, pegs and box included",
              "For memorial services, celebrations and promotional events",
            ],
          }}
          mediaFirst
        />
      ) : null}
      {wallBanner ? (
        <ProductStory
          product={wallBanner}
          ctaHref={`/products/${wallBanner.slug}/configure`}
          ctaLabel="Create Wall Banner"
          copy={{
            title: "Wall banner",
            summary:
              "Custom wall banners for memorials, celebrations and meaningful occasions.",
            features: [
              "Reinforced edge and eyelet finish",
              "Personalised artwork and wording",
              "Draft prepared before printing",
            ],
          }}
        />
      ) : null}

      <FacebookReviews page={reviewPage} pagePath="/" />

      <section className={styles.selectedWork}>
        <div className={styles.sectionHeading}>
          <div>
            <h2>Made for real moments.</h2>
          </div>
          <Link href="/design-gallery">View the design gallery</Link>
        </div>
        <div className={styles.productGrid}>
          {selectedWork.map((product) => (
            <ProductCard key={product.key} product={product} />
          ))}
        </div>
      </section>

      <section className={styles.process}>
        <div className={styles.processHeader}>
          <p className={styles.eyebrow}>{content.processEyebrow ?? defaultHeroContent.processEyebrow}</p>
          <h2>{content.processTitle ?? defaultHeroContent.processTitle}</h2>
        </div>
        <div className={styles.processGrid}>
          <article className={styles.processStep}>
            <span>01</span>
            <h3>Choose your format</h3>
            <p>Select the product, size and details that fit your story.</p>
          </article>
          <article className={styles.processStep}>
            <span>02</span>
            <h3>Share your photos</h3>
            <p>Upload clear originals now or send them after ordering.</p>
          </article>
          <article className={styles.processStep}>
            <span>03</span>
            <h3>Review the draft</h3>
            <p>Approve your artwork before it moves into production.</p>
          </article>
        </div>
      </section>

      <section className={styles.finalCta}>
        <div>
          <h2>Turn a memory into something lasting.</h2>
          <p>
            Explore the full range or browse real formats for inspiration before
            you start.
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryButton} href="/shop">
              View all products
            </Link>
            <Link className={styles.secondaryButton} href="/design-gallery">
              Browse the gallery
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

export default async function Home({ searchParams }: HomeProps) {
  const rawReviewPage = (await searchParams).reviews;
  const reviewPage = Number(Array.isArray(rawReviewPage) ? rawReviewPage[0] : rawReviewPage);
  const [managed, { registry }] = await Promise.all([
    getSafePublicContent([
      "home.hero.eyebrow",
      "home.hero.title",
      "home.hero.subtitle",
      "home.hero.primary_cta",
      "home.hero.secondary_cta",
      "home.process.eyebrow",
      "home.process.title",
    ]),
    getSafePublicProductRegistry(),
  ]);

  return (
    <HomeContent
      reviewPage={Number.isInteger(reviewPage) ? reviewPage : 1}
      registry={registry}
      content={{
        eyebrow: managed["home.hero.eyebrow"],
        title: managed["home.hero.title"],
        subtitle: managed["home.hero.subtitle"],
        primaryCta: managed["home.hero.primary_cta"],
        secondaryCta: managed["home.hero.secondary_cta"],
        processEyebrow: managed["home.process.eyebrow"],
        processTitle: managed["home.process.title"],
      }}
    />
  );
}
