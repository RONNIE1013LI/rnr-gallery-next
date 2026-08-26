import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMarketMoney } from "@/domain/money";
import { PaymentRequestActions } from "@/components/admin/payment-request-actions";
import styles from "@/components/admin/admin.module.css";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import { getPaymentRequestRuntime } from "@/server/payment-requests/payment-request-runtime";

export default async function AdminPaymentRequestPage({ params }: Readonly<{ params: Promise<{ requestId: string }> }>) {
  const { requestId } = await params;
  await requireAdminPage(`/admin/payment-requests/${encodeURIComponent(requestId)}`, "manage_payment");
  const request = await getPaymentRequestRuntime().adminById(requestId);
  if (!request) notFound();
  return <section className={`${styles.pageSection} ${styles.narrowPage}`}>
    <header className={styles.pageHeader}><div><nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><Link href="/admin/payment-requests">Payment Requests</Link><span>/</span><span>{request.requestNumber}</span></nav><h1>{request.requestNumber}</h1><p>{request.description}</p></div><span className={styles.statusBadge}>{request.status}</span></header>
    <section className={styles.panel}><h2>Request details</h2><dl className={styles.stackedDefinitionList}>
      <div><dt>Type</dt><dd>{request.kind === "order_balance" ? "Order balance" : "Standalone"}</dd></div>
      {request.orderNumber ? <div><dt>Order</dt><dd><Link href={`/admin/orders/${request.orderId}`}>{request.orderNumber}</Link></dd></div> : null}
      <div><dt>Fixed amount</dt><dd>{formatMarketMoney(request.amountCents, request.currency)}</dd></div>
      <div><dt>Payment methods</dt><dd>{request.methods.map((method) => method === "card" ? "Card" : "Afterpay").join(", ")}</dd></div>
      <div><dt>Created by</dt><dd>{request.createdByName ?? "Unknown staff"}</dd></div>
      {request.expiresAt ? <div><dt>Expires</dt><dd>{new Intl.DateTimeFormat("en-NZ", { dateStyle: "medium", timeStyle: "short" }).format(new Date(request.expiresAt))}</dd></div> : null}
      {request.customerName ? <div><dt>Customer</dt><dd>{request.customerName}</dd></div> : null}
      {request.customerEmail ? <div><dt>Email</dt><dd>{request.customerEmail}</dd></div> : null}
      {request.internalNote ? <div><dt>Internal note</dt><dd>{request.internalNote}</dd></div> : null}
      {request.statusReason ? <div><dt>Status reason</dt><dd>{request.statusReason}</dd></div> : null}
    </dl></section>
    {request.status === "pending" ? <PaymentRequestActions requestId={request.id} /> : null}
  </section>;
}
