import type { Metadata } from "next";
import { CheckoutView } from "@/components/checkout-view";
import styles from "@/components/storefront.module.css";
import { createDrizzleAddressRepository } from "@/server/addresses/drizzle-address-repository";
import { getOptionalSession } from "@/server/auth/get-optional-session";
import { getDatabase } from "@/server/db/client";

export const metadata: Metadata = { title: "Checkout" };

export default async function CheckoutPage() {
  const session = await getOptionalSession();
  const addresses = session ? await createDrizzleAddressRepository(getDatabase()).listByOwner(session.user.id) : [];
  const savedAddresses = addresses.map(({ id, country, fullName, building, street, suburb, region, postcode, phone, email }) => ({ id, country, fullName, building, street, suburb, region, postcode, phone, email }));
  return <main id="main-content" className={styles.checkoutPage}><header className={styles.cartHeader}><p className={styles.eyebrow}>Secure checkout</p><h1>Checkout</h1></header><CheckoutView savedAddresses={savedAddresses} /></main>;
}
