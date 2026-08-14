import Link from "next/link";
import styles from "@/components/storefront.module.css";

export default function NotFound() {
  return (
    <main id="main-content" className={styles.legalPage}>
      <article>
        <p className={styles.eyebrow}>404</p>
        <h1>This page could not be found.</h1>
        <p>The address may have changed. Continue shopping, browse real design inspiration, or contact us for help.</p>
        <div className={styles.legalActions}>
          <Link className={styles.primaryButton} href="/shop">Shop</Link>
          <Link className={styles.secondaryButton} href="/design-gallery">Design Gallery</Link>
          <a className={styles.secondaryButton} href="mailto:customerservice@rnrgallery.com">Contact</a>
        </div>
      </article>
    </main>
  );
}
