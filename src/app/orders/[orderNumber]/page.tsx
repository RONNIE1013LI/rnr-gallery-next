import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { OrderDetail } from "@/components/order-detail";
import styles from "@/components/storefront.module.css";
import { getOptionalSession } from "@/server/auth/get-optional-session";
import { CHECKOUT_SESSION_COOKIE_NAME, hashCheckoutSessionToken } from "@/server/checkout/session-cookie";
import { getDatabase } from "@/server/db/client";
import { createDrizzleOrderQueryRepository } from "@/server/orders/drizzle-order-query-repository";
import { createOrderQueryService } from "@/server/orders/order-query-service";

export default async function OrderConfirmationPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  const [{ orderNumber }, cookieStore, session] = await Promise.all([params, cookies(), getOptionalSession()]);
  const token = cookieStore.get(CHECKOUT_SESSION_COOKIE_NAME)?.value;
  const order = await createOrderQueryService(createDrizzleOrderQueryRepository(getDatabase())).confirmation(orderNumber, { tokenDigest: token ? hashCheckoutSessionToken(token) : null, userId: session?.user.id ?? null });
  if (!order) notFound();
  return <main id="main-content" className={styles.orderPage}><OrderDetail order={order} /><section className={styles.orderNext}><h2>Payment setup is next</h2><p>No payment has been requested on this test platform yet.</p><div><Link className={styles.primaryButton} href="/shop">Continue browsing</Link>{session ? <Link className={styles.secondaryButton} href="/account/orders">View account orders</Link> : <Link className={styles.secondaryButton} href="/account/sign-in">Sign in</Link>}</div></section></main>;
}
