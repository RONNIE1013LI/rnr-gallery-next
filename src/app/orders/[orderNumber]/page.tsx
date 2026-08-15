import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { customerOrderHeading, OrderDetail } from "@/components/order-detail";
import { OrderPaymentPanel } from "@/components/order-payment-panel";
import { CustomerProofPanel } from "@/components/customer-proof-panel";
import { PurchaseTracker } from "@/components/purchase-tracker";
import { buildPurchaseEvent } from "@/domain/analytics/events";
import styles from "@/components/storefront.module.css";
import { getOptionalSession } from "@/server/auth/get-optional-session";
import { getCheckoutSessionCookieName, hashCheckoutSessionToken, isCheckoutSessionToken } from "@/server/checkout/session-cookie";
import { getDatabase } from "@/server/db/client";
import { createDrizzleOrderQueryRepository, OrderSnapshotIntegrityError } from "@/server/orders/drizzle-order-query-repository";
import { createOrderQueryService } from "@/server/orders/order-query-service";
import { resolveCustomerProofAccess } from "@/server/production/customer-proof-access";
import { getOptionalCustomerProofView } from "@/server/production/optional-customer-proof";

export const metadata: Metadata = {
  title: "Order details",
  robots: { index: false, follow: false },
};

export default async function OrderConfirmationPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  const [{ orderNumber }, cookieStore, session] = await Promise.all([params, cookies(), getOptionalSession()]);
  const token = cookieStore.get(getCheckoutSessionCookieName(session?.user.id ?? null))?.value;
  let order;
  try {
    order = await createOrderQueryService(createDrizzleOrderQueryRepository(getDatabase())).confirmation(orderNumber, { tokenDigest: isCheckoutSessionToken(token) ? hashCheckoutSessionToken(token) : null, userId: session?.user.id ?? null });
  } catch (error) {
    if (error instanceof OrderSnapshotIntegrityError) notFound();
    throw error;
  }
  if (!order) notFound();
  const proofAccess = resolveCustomerProofAccess({
    orderNumber,
    userId: session?.user.id ?? null,
    checkoutToken: token ?? null,
  }, process.env.BETTER_AUTH_SECRET ?? "");
  const proof = proofAccess ? await getOptionalCustomerProofView(orderNumber, proofAccess) : null;
  return <main id="main-content" className={styles.orderPage}><PurchaseTracker event={buildPurchaseEvent(order)} /><OrderDetail order={order} heading={customerOrderHeading(order.paymentStatus)} showPaymentGuidance />{proof ? <CustomerProofPanel proof={proof} /> : null}<OrderPaymentPanel orderNumber={order.orderNumber} paymentStatus={order.paymentStatus} payment={order.payment} orderHref={`/orders/${order.orderNumber}`} totalInclGstCents={order.totals.totalInclGstCents} /><section className={styles.orderNext}><h2>Next steps</h2><div><Link className={styles.primaryButton} href="/shop">Continue browsing</Link>{session ? <Link className={styles.secondaryButton} href="/account/orders">View account orders</Link> : <Link className={styles.secondaryButton} href="/account/sign-in">Sign in</Link>}</div></section></main>;
}
