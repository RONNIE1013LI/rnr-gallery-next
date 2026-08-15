import Link from "next/link";
import styles from "./storefront.module.css";

export function AustraliaUnavailable() {
  return (
    <main id="main-content" className={styles.pageMain}>
      <header className={styles.pageIntro}>
        <p className={styles.eyebrow}>Australia · AUD</p>
        <h1>Australia ordering is not available yet.</h1>
        <p>
          We are preparing fixed Australian pricing. Australia checkout stays closed
          until every product, option and delivery price has been reviewed and enabled.
        </p>
        <Link href="/" className={styles.secondaryButton}>View New Zealand site</Link>
      </header>
    </main>
  );
}
