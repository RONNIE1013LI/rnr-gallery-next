import type { Metadata } from "next";
import { CartView } from "@/components/cart-view";
import styles from "@/components/storefront.module.css";

export const metadata: Metadata = { title: "Cart" };

export default function CartPage() {
  return (
    <main id="main-content" className={styles.cartPage}>
      <header className={styles.cartHeader}>
        <p className={styles.eyebrow}>Your order</p>
        <h1>Cart</h1>
      </header>
      <CartView />
    </main>
  );
}
