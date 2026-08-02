import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountSignOut } from "@/components/account-sign-out";
import styles from "@/components/storefront.module.css";
import { HttpError, requireSession } from "@/server/auth/require-session";

export const metadata: Metadata = { title: "Account" };

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

export default async function AccountPage() {
  await authenticatedSession();

  return (
    <main id="main-content" className={styles.legalPage}>
      <article className={styles.accountPage}>
        <p className={styles.eyebrow}>Customer account</p>
        <h1>Your account.</h1>
        <p>Manage the details that make ordering from R&amp;R Gallery simpler.</p>
        <nav aria-label="Account" className={styles.accountNavigation}>
          <Link className={styles.secondaryButton} href="/account/addresses">
            Saved addresses
          </Link>
          <a className={styles.secondaryButton} href="#orders">Orders</a>
          <AccountSignOut />
        </nav>
        <section className={styles.accountUpcoming} id="orders">
          <h2>Orders</h2>
          <p>The orders area is coming next. Order tracking is not available here yet.</p>
        </section>
      </article>
    </main>
  );
}
