import Link from "next/link";
import { formatMarketMoney } from "@/domain/money";
import styles from "@/components/admin/admin.module.css";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import { getPaymentRequestRuntime } from "@/server/payment-requests/payment-request-runtime";

export const metadata = { title: "Payment Requests | R&R Gallery Admin" };

export default async function AdminPaymentRequestsPage() {
  await requireAdminPage("/admin/payment-requests", "manage_payment");
  const requests = await getPaymentRequestRuntime().listAdmin();
  return <section className={styles.pageSection}>
    <header className={styles.pageHeader}><div><nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><span>Payment Requests</span></nav><h1>Payment Requests</h1><p>Fixed-amount links for Order balances and standalone payments.</p></div><Link className={styles.primaryAdminButton} href="/admin/payment-requests/new">New payment request</Link></header>
    {requests.length ? <div className={styles.tableScroll}><table className={styles.dataTable}><thead><tr><th>Request</th><th>Type</th><th>Description</th><th>Amount</th><th>Status</th><th>Created</th><th /></tr></thead><tbody>{requests.map((request) => <tr key={request.id}>
      <td><strong>{request.requestNumber}</strong>{request.orderNumber ? <small>Order {request.orderNumber}</small> : null}</td>
      <td>{request.kind === "order_balance" ? "Order balance" : "Standalone"}</td>
      <td>{request.description}</td>
      <td className={styles.numeric}>{formatMarketMoney(request.amountCents, request.currency)}</td>
      <td><span className={styles.statusBadge}>{request.status}</span></td>
      <td>{new Intl.DateTimeFormat("en-NZ", { dateStyle: "medium" }).format(new Date(request.createdAt))}</td>
      <td><Link className={styles.tableAction} href={`/admin/payment-requests/${request.id}`}>Open</Link></td>
    </tr>)}</tbody></table></div> : <div className={styles.emptyState}><h2>No payment requests</h2><p>Create a standalone request here, or an Order balance request from an Order.</p><Link href="/admin/payment-requests/new">Create payment request</Link></div>}
  </section>;
}
