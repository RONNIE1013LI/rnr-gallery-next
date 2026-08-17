import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthGateway } from "@/components/auth-gateway";
import styles from "@/components/storefront.module.css";
import { getOptionalSession } from "@/server/auth/get-optional-session";
import { getConfiguredSocialProviderIds } from "@/server/auth/social-provider-config";
import type { SocialProviderId } from "@/server/auth/social-provider-config";

export const metadata: Metadata = {
  title: "Sign in for faster checkout",
  robots: { index: false, follow: false },
};

export default async function CheckoutStartPage() {
  if (await getOptionalSession()) {
    redirect("/checkout");
  }

  const configuredProviders = getConfiguredSocialProviderIds(process.env);
  const customerProviders = configuredProviders.includes("google")
    ? (["google"] as const)
    : ([] as const) as ReadonlyArray<SocialProviderId>;

  return (
    <main id="main-content" className={styles.checkoutEntryPage}>
      <div className={styles.checkoutEntry}>
        <header className={styles.checkoutEntryHeader}>
          <Link className={styles.checkoutBackLink} href="/cart">
            <span aria-hidden="true">←</span> Back to cart
          </Link>
          <h1>Sign in for faster checkout.</h1>
        </header>

        <div className={styles.checkoutEntryLayout}>
          <section
            aria-labelledby="checkout-account-title"
            className={styles.checkoutContinuation}
          >
            <h2 id="checkout-account-title">Check out with your R&amp;R Gallery account</h2>

            <AuthGateway
              configuredProviders={customerProviders}
              mode="sign-in"
              returnTo="/checkout"
              showIntro={false}
            />
          </section>

          <section
            aria-labelledby="guest-checkout-title"
            className={styles.checkoutGuestPanel}
          >
            <h2 id="guest-checkout-title">Guest Checkout</h2>
            <p className={styles.checkoutGuestDescription}>
              Proceed now and create an account later.
            </p>
            <Link className={styles.primaryButton} href="/checkout">
              Continue as Guest
            </Link>
          </section>
        </div>
      </div>
    </main>
  );
}
