import type { Metadata } from "next";
import { cookies } from "next/headers";
import { CheckoutView } from "@/components/checkout-view";
import styles from "@/components/storefront.module.css";
import { createDrizzleAddressRepository } from "@/server/addresses/drizzle-address-repository";
import { getOptionalSession } from "@/server/auth/get-optional-session";
import { getDatabase } from "@/server/db/client";
import { MARKET_COOKIE_NAME, parseMarketCookie } from "@/server/markets/market-cookie";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

export default async function CheckoutPage() {
  const [session, cookieStore] = await Promise.all([getOptionalSession(), cookies()]);
  const market = parseMarketCookie(cookieStore.get(MARKET_COOKIE_NAME)?.value) ?? "NZ";
  const addresses = session ? await createDrizzleAddressRepository(getDatabase()).listByOwner(session.user.id) : [];
  const savedAddresses = addresses.map(({ id, country, fullName, building, street, suburb, region, postcode, phone, email }) => ({ id, country, fullName, building, street, suburb, region, postcode, phone, email }));
  return <main id="main-content" className={styles.checkoutPage}><header className={styles.cartHeader}><p className={styles.eyebrow}>Secure checkout</p><h1>Checkout</h1></header><CheckoutView market={market} savedAddresses={savedAddresses} /></main>;
}
