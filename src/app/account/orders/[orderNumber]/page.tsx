import { notFound } from "next/navigation";
import { OrderDetail } from "@/components/order-detail";
import { OrderPaymentPanel } from "@/components/order-payment-panel";
import { CustomerProofPanel } from "@/components/customer-proof-panel";
import styles from "@/components/storefront.module.css";
import { requireAccountPage } from "@/server/auth/require-account-page";
import { getDatabase } from "@/server/db/client";
import { createDrizzleOrderQueryRepository, OrderSnapshotIntegrityError } from "@/server/orders/drizzle-order-query-repository";
import { getOptionalCustomerProofView } from "@/server/production/optional-customer-proof";

export default async function AccountOrderPage({ params }: { params: Promise<{ orderNumber: string }> }) { const { orderNumber } = await params; const session = await requireAccountPage(`/account/orders/${encodeURIComponent(orderNumber)}`); let order; try { order = await createDrizzleOrderQueryRepository(getDatabase()).findByCustomer(orderNumber, session.user.id); } catch (error) { if (error instanceof OrderSnapshotIntegrityError) notFound(); throw error; } if (!order) notFound(); const proof = await getOptionalCustomerProofView(orderNumber, { kind: "customer", userId: session.user.id }); return <main id="main-content" className={styles.orderPage}><OrderDetail order={order} />{proof ? <CustomerProofPanel proof={proof} /> : null}<OrderPaymentPanel orderNumber={order.orderNumber} paymentStatus={order.paymentStatus} payment={order.payment} orderHref={`/account/orders/${order.orderNumber}`} totalInclGstCents={order.totals.totalInclGstCents} /></main>; }
