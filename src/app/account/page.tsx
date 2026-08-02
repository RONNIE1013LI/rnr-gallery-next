import type { Metadata } from "next";
import styles from "@/components/storefront.module.css";

export const metadata: Metadata = { title: "Account" };

export default function AccountPage() {
  return (
    <main id="main-content" className={styles.legalPage}>
      <article>
        <p className={styles.eyebrow}>Customer account</p>
        <h1>Keep every order in one place.</h1>
        <p>
          Secure account access, saved addresses, draft reviews and order tracking
          will be enabled with the commerce workflow.
        </p>
      </article>
    </main>
  );
}
