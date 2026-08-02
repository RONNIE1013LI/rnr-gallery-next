import Link from "next/link";
import styles from "@/components/storefront.module.css";

export default function NotFound() {
  return (
    <main id="main-content" className={styles.legalPage}>
      <article>
        <p className={styles.eyebrow}>404</p>
        <h1>This page could not be found.</h1>
        <p><Link className={styles.primaryButton} href="/">Return home</Link></p>
      </article>
    </main>
  );
}
