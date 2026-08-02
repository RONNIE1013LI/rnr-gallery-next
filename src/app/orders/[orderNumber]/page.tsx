import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { OrderDetail } from "@/components/order-detail";
import { OrderPaymentPanel } from "@/components/order-payment-panel";
import styles from "@/components/storefront.module.css";
import { getOptionalSession } from "@/server/auth/get-optional-session";
import { CHECKOUT_SESSION_COOKIE_NAME, hashCheckoutSessionToken, isCheckoutSessionToken } from "@/server/checkout/session-cookie";
import { getDatabase } from "@/server/db/client";
import { createDrizzleOrderQueryRepository, OrderSnapshotIntegrityError } from "@/server/orders/drizzle-order-query-repository";
import { createOrderQueryService } from "@/server/orders/order-query-service";
import { parsePaymentConfig } from "@/server/payments/config";
import { selectPaymentProviders } from "@/server/payments/provider-registry";

function configuredPaymentMethods() {
  return selectPaymentProviders(parsePaymentConfig()).map(({ method, label, isTest }) => ({ method, label, isTest }));
}

export default async function OrderConfirmationPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  const [{ orderNumber }, cookieStore, session] = await Promise.all([params, cookies(), getOptionalSession()]);
  const token = cookieStore.get(CHECKOUT_SESSION_COOKIE_NAME)?.value;
  let order;
  try {
    order = await createOrderQueryService(createDrizzleOrderQueryRepository(getDatabase())).confirmation(orderNumber, { tokenDigest: isCheckoutSessionToken(token) ? hashCheckoutSessionToken(token) : null, userId: session?.user.id ?? null });
  } catch (error) {
    if (error instanceof OrderSnapshotIntegrityError) notFound();
    throw error;
  }
  if (!order) notFound();
  return <main id="main-content" className={styles.orderPage}><OrderDetail order={order} heading="Order received." /><OrderPaymentPanel orderNumber={order.orderNumber} paymentStatus={order.paymentStatus} methods={configuredPaymentMethods()} orderHref={`/orders/${order.orderNumber}`} /><section className={styles.orderNext}><h2>Next steps</h2><div><Link className={styles.primaryButton} href="/shop">Continue browsing</Link>{session ? <Link className={styles.secondaryButton} href="/account/orders">View account orders</Link> : <Link className={styles.secondaryButton} href="/account/sign-in">Sign in</Link>}</div></section></main>;
}
