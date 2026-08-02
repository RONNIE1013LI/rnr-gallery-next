import Link from "next/link";
import { redirect } from "next/navigation";
import styles from "@/components/storefront.module.css";
import { formatNzd } from "@/domain/money";
import { orderPaymentStatusLabels } from "@/components/order-detail";
import { HttpError, requireSession } from "@/server/auth/require-session";
import { getDatabase } from "@/server/db/client";
import { createDrizzleOrderQueryRepository } from "@/server/orders/drizzle-order-query-repository";

async function sessionOrRedirect() { try { return await requireSession(); } catch (error) { if (error instanceof HttpError && error.status === 401) redirect("/account/sign-in"); throw error; } }
export default async function AccountOrdersPage() { const session = await sessionOrRedirect(); const orders = await createDrizzleOrderQueryRepository(getDatabase()).listByCustomer(session.user.id); return <main id="main-content" className={styles.orderPage}><header><p className={styles.eyebrow}>Customer account</p><h1>Your orders.</h1></header>{orders.length ? <ul className={styles.orderHistory}>{orders.map((order) => <li key={order.orderNumber}><Link href={`/account/orders/${order.orderNumber}`}><strong>{order.orderNumber}</strong><span>{new Intl.DateTimeFormat("en-NZ").format(new Date(order.createdAt))}</span><span>{orderPaymentStatusLabels[order.paymentStatus]}</span><span>{formatNzd(order.totals.totalInclGstCents)}</span></Link></li>)}</ul> : <section className={styles.cartEmpty}><h2>No orders yet</h2><p>Your completed checkout orders will appear here.</p><Link className={styles.primaryButton} href="/shop">Explore products</Link></section>}</main>; }
