import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SavedAddresses } from "@/components/saved-addresses";
import styles from "@/components/storefront.module.css";
import { createDrizzleAddressRepository } from "@/server/addresses/drizzle-address-repository";
import { HttpError, requireSession } from "@/server/auth/require-session";
import { getDatabase } from "@/server/db/client";

export const metadata: Metadata = { title: "Saved addresses" };

async function authenticatedSession() {
  try {
    return await requireSession();
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      redirect("/account/sign-in");
    }
    throw error;
  }
}

export default async function AddressesPage() {
  const session = await authenticatedSession();
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
        <p><Link href="/account">Back to account</Link></p>
        <SavedAddresses initialAddresses={addresses} />
      </article>
    </main>
  );
}
