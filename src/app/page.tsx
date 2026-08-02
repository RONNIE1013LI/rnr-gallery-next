import Image from "next/image";
import Link from "next/link";
import { ProductCard } from "@/components/product-card";
import { ProductStory } from "@/components/product-story";
import { getProductBySlug, products } from "@/domain/catalogue/products";
import styles from "@/components/storefront.module.css";

function requiredProduct(slug: string) {
  const product = getProductBySlug(slug);
  if (!product) throw new Error(`Missing homepage product: ${slug}`);
  return product;
}

export default function Home() {
  const digitalOil = requiredProduct("digital-oil-painting-canvas");
  const rollUp = requiredProduct("roll-up-banner");
  const wallBanner = requiredProduct("custom-themed-wall-banner");
  const selectedWork = products.filter((product) =>
    [
      "photo-print-canvas",
      "digital-oil-painting-canvas",
      "roll-up-banner",
      "custom-themed-wall-banner",
    ].includes(product.slug),
  );

  return (
    <main id="main-content">
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Made around what matters</p>
          <h1>Art made from your story.</h1>
          <p className={styles.heroLead}>
            Turn meaningful photos into personal canvas and banner artwork,
            created with care in New Zealand.
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryButton} href="/shop">
              Create your artwork
            </Link>
            <Link className={styles.secondaryButton} href="/design-gallery">
              Explore the gallery
            </Link>
          </div>
        </div>
        <div className={styles.heroMedia}>
          <Image
            src="/media/home/family-canvas.webp"
            alt="Personalised family canvas displayed in a warm home interior"
            fill
            priority
            sizes="(max-width: 820px) 100vw, 60vw"
          />
        </div>
      </section>

      <ProductStory
        product={digitalOil}
        eyebrow="Digital oil painting canvas"
        ctaLabel="Create an oil painting canvas"
      />
      <ProductStory
        product={rollUp}
        eyebrow="Roll-up banner"
        ctaLabel="Create a roll-up banner"
        mediaFirst
      />
      <ProductStory
        product={wallBanner}
        eyebrow="Wall banner"
        ctaLabel="Create a wall banner"
      />

      <section className={styles.selectedWork}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Selected formats</p>
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
          <p className={styles.eyebrow}>How it works</p>
          <h2>Simple steps. Personal results.</h2>
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
          <p className={styles.eyebrow}>Begin your piece</p>
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
