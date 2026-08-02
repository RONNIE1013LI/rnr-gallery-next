import type { Metadata } from "next";
import Link from "next/link";
import styles from "@/components/storefront.module.css";

export const metadata: Metadata = { title: "Cart" };

export default function CartPage() {
  return (
    <main id="main-content" className={styles.legalPage}>
      <article>
        <p className={styles.eyebrow}>Your order</p>
        <h1>Your cart is empty.</h1>
        <p>Choose a custom product to begin creating your artwork.</p>
        <p><Link className={styles.primaryButton} href="/shop">Explore products</Link></p>
      </article>
    </main>
  );
}
