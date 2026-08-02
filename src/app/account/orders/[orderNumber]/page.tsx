import { notFound, redirect } from "next/navigation";
import { OrderDetail } from "@/components/order-detail";
import styles from "@/components/storefront.module.css";
import { HttpError, requireSession } from "@/server/auth/require-session";
import { getDatabase } from "@/server/db/client";
import { createDrizzleOrderQueryRepository, OrderSnapshotIntegrityError } from "@/server/orders/drizzle-order-query-repository";

async function sessionOrRedirect() { try { return await requireSession(); } catch (error) { if (error instanceof HttpError && error.status === 401) redirect("/account/sign-in"); throw error; } }
export default async function AccountOrderPage({ params }: { params: Promise<{ orderNumber: string }> }) { const [session, { orderNumber }] = await Promise.all([sessionOrRedirect(), params]); let order; try { order = await createDrizzleOrderQueryRepository(getDatabase()).findByCustomer(orderNumber, session.user.id); } catch (error) { if (error instanceof OrderSnapshotIntegrityError) notFound(); throw error; } if (!order) notFound(); return <main id="main-content" className={styles.orderPage}><OrderDetail order={order} /></main>; }
