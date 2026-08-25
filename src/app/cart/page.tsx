import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { CartView } from "@/components/cart-view";
import styles from "@/components/storefront.module.css";
import { MARKET_COOKIE_NAME, parseMarketCookie } from "@/server/markets/market-cookie";

export const metadata: Metadata = {
  title: "Cart",
  robots: { index: false, follow: false },
};

export default async function CartPage() {
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()]);
  const market = parseMarketCookie(requestHeaders.get("x-rnr-resolved-market"))
    ?? parseMarketCookie(cookieStore.get(MARKET_COOKIE_NAME)?.value)
    ?? "NZ";
  return (
    <main id="main-content" className={styles.cartPage}>
      <header className={styles.cartHeader}>
        <p className={styles.eyebrow}>Your order</p>
        <h1>Cart</h1>
      </header>
      <CartView market={market} />
    </main>
  );
}
