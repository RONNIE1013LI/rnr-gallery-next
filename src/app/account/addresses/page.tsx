import type { Metadata } from "next";
import Link from "next/link";
import { SavedAddresses } from "@/components/saved-addresses";
import styles from "@/components/storefront.module.css";
import { createDrizzleAddressRepository } from "@/server/addresses/drizzle-address-repository";
import { requireAccountPage } from "@/server/auth/require-account-page";
import { getDatabase } from "@/server/db/client";

export const metadata: Metadata = { title: "Saved addresses" };

export default async function AddressesPage() {
  const session = await requireAccountPage("/account/addresses");
  const savedAddresses = await createDrizzleAddressRepository(getDatabase()).listByOwner(
    session.user.id,
  );
  const addresses = savedAddresses.map((address) => ({
    id: address.id,
    country: address.country,
    fullName: address.fullName,
    building: address.building,
    street: address.street,
    suburb: address.suburb,
    region: address.region,
    postcode: address.postcode,
    phone: address.phone,
    email: address.email,
  }));

  return (
    <main id="main-content" className={styles.legalPage}>
      <article className={styles.accountPage}>
        <p className={styles.eyebrow}>Customer account</p>
        <h1>Saved addresses.</h1>
        <p>Keep your New Zealand and Australian delivery details ready for checkout.</p>
        <p><Link className={styles.accountBackLink} href="/account">Back to account</Link></p>
        <SavedAddresses initialAddresses={addresses} />
      </article>
    </main>
  );
}
