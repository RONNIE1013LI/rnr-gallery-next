import Link from "next/link";
import styles from "@/components/storefront.module.css";
import { buildPublicMetadata } from "@/server/seo/metadata";

export const metadata = buildPublicMetadata({
  title: "About R&R Gallery",
  description: "Meet R&R Gallery Ltd, a New Zealand business creating custom canvas, banners and personalised print products.",
  path: "/about",
  image: "/media/home/homepage-canvas-finished.webp",
  imageAlt: "A finished personalised canvas by R&R Gallery",
});

export default function AboutPage() {
  return (
    <main id="main-content" className={styles.legalPage}>
      <article>
        <p className={styles.eyebrow}>About us</p>
        <h1>Personalised artwork, designed in New Zealand.</h1>
        <p>R&amp;R Gallery Ltd creates custom canvas, banners and print products from customer photos, wording and ideas.</p>
        <p>Every personalised order includes a proof before printing and two revision rounds, so the artwork can be checked before production begins.</p>
        <h2>How we work</h2>
        <p>Choose a product and size, send photos now or after ordering, then review the draft before it is printed.</p>
        <div className={styles.legalActions}>
          <Link className={styles.primaryButton} href="/shop">Explore Products</Link>
          <Link className={styles.secondaryButton} href="/how-it-works">How It Works</Link>
        </div>
      </article>
    </main>
  );
}
