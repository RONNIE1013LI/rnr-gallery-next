import type { Metadata } from "next";
import Link from "next/link";
import { AccountSignOut } from "@/components/account-sign-out";
import { AuthGateway } from "@/components/auth-gateway";
import {
  formatOrderDate,
  orderFulfilmentStatusLabels,
  orderPaymentStatusLabels,
} from "@/components/order-detail";
import styles from "@/components/storefront.module.css";
import { formatNzd } from "@/domain/money";
import { createDrizzleAddressRepository } from "@/server/addresses/drizzle-address-repository";
import { getOptionalSession } from "@/server/auth/get-optional-session";
import {
  getConfiguredSocialProviderIds,
  type SocialProviderId,
} from "@/server/auth/social-provider-config";
import { getDatabase } from "@/server/db/client";
import { createDrizzleOrderQueryRepository } from "@/server/orders/drizzle-order-query-repository";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const session = await getOptionalSession();
  if (!session) {
    const configuredProviders = getConfiguredSocialProviderIds(process.env);
    const customerProviders = configuredProviders.includes("google")
      ? (["google"] as const)
      : ([] as const) as ReadonlyArray<SocialProviderId>;

    return <main id="main-content" className={styles.legalPage}>
      <article className={`${styles.authPage} ${styles.customerAuthPage}`}>
        <AuthGateway
          configuredProviders={customerProviders}
          mode="sign-in"
          returnTo="/account"
        />
      </article>
    </main>;
  }

  const database = getDatabase();
  const [recentOrders, savedAddresses] = await Promise.all([
    createDrizzleOrderQueryRepository(database).listPageByCustomer(session.user.id, 1, 1),
    createDrizzleAddressRepository(database).listByOwner(session.user.id),
  ]);
  const latestOrder = recentOrders.items[0];
  const firstAddress = savedAddresses[0];

  return (
    <main id="main-content" className={styles.legalPage}>
      <article className={`${styles.accountPage} ${styles.accountOverview}`}>
        <header className={styles.accountOverviewHeader}>
          <p className={styles.eyebrow}>Customer account</p>
          <h1>Your account.</h1>
          <p>Manage the details that make ordering from R&amp;R Gallery simpler.</p>
        </header>
        <div className={styles.accountOverviewGrid}>
          <section className={styles.accountSummarySection}>
            <div className={styles.accountSummaryHeading}>
              <h2>Recent order</h2>
              <Link href="/account/orders">View all orders</Link>
            </div>
            {latestOrder ? <Link className={styles.accountLatestOrder} href={`/account/orders/${latestOrder.orderNumber}`}>
              <strong>{latestOrder.orderNumber}</strong>
              <span>{formatOrderDate(latestOrder.createdAt)} · {formatNzd(latestOrder.totals.totalInclGstCents)}</span>
              <dl>
                <div><dt>Payment</dt><dd>{orderPaymentStatusLabels[latestOrder.paymentStatus]}</dd></div>
                <div><dt>Production</dt><dd>{latestOrder.paymentStatus === "paid"
                  ? orderFulfilmentStatusLabels[latestOrder.fulfilmentStatus]
                  : "Starts after payment"}</dd></div>
              </dl>
            </Link> : <div className={styles.accountEmptySummary}>
              <p>You do not have any orders yet.</p>
              <Link href="/shop">Browse products</Link>
            </div>}
          </section>

          <section className={styles.accountSummarySection}>
            <div className={styles.accountSummaryHeading}>
              <h2>Saved addresses</h2>
              <Link href="/account/addresses">Manage addresses</Link>
            </div>
            {firstAddress ? <address className={styles.accountAddressSummary}>
              <strong>{firstAddress.fullName}</strong>
              <span>{firstAddress.building ? `${firstAddress.building}, ` : ""}{firstAddress.street}</span>
              <span>{firstAddress.suburb}, {firstAddress.region} {firstAddress.postcode}</span>
              <span>{savedAddresses.length} saved {savedAddresses.length === 1 ? "address" : "addresses"}</span>
            </address> : <div className={styles.accountEmptySummary}>
              <p>No saved addresses yet.</p>
              <Link href="/account/addresses">Add an address</Link>
            </div>}
          </section>
        </div>
        <nav aria-label="Account" className={styles.accountNavigation}>
          <Link className={styles.secondaryButton} href="/shop">Start a new order</Link>
          <AccountSignOut />
        </nav>
      </article>
    </main>
  );
}
