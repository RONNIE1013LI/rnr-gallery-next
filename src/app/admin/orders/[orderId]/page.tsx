import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminOrderDetail } from "@/components/admin/order-detail";
import { CopyOrderNumber } from "@/components/admin/copy-order-number";
import styles from "@/components/admin/admin.module.css";
import { getAdminOrderRuntime } from "@/server/admin/admin-order-runtime";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import { hasAdminPermission } from "@/server/auth/admin-permissions";
import { getPaymentRequestRuntime } from "@/server/payment-requests/payment-request-runtime";

type Props = Readonly<{ params: Promise<{ orderId: string }> }>;

export function canLoadPaymentSummary(paymentStatus: string) {
  return paymentStatus !== "cancelled" && paymentStatus !== "refunded";
}

export default async function AdminOrderDetailPage({ params }: Props) {
  const { orderId } = await params;
  const access = await requireAdminPage(`/admin/orders/${encodeURIComponent(orderId)}`, "view_orders");
  const detail = await getAdminOrderRuntime().detail(orderId);
  if (!detail) notFound();
  const paymentSummary = hasAdminPermission(access.adminRole, access.adminPermissions, "manage_payment")
    && canLoadPaymentSummary(detail.order.paymentStatus)
    ? await getPaymentRequestRuntime().orderSummary(orderId)
    : null;

  return (
    <section className={styles.pageSection}>
      <header className={styles.pageHeader}>
        <div>
          <nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><Link href="/admin/orders">Orders</Link><span>/</span><span>{detail.order.orderNumber}</span></nav>
          <h1>{detail.order.orderNumber}</h1>
          <p>Created {new Intl.DateTimeFormat("en-NZ", { dateStyle: "full", timeStyle: "short", timeZone: "Pacific/Auckland" }).format(detail.order.createdAt)}</p>
        </div>
        <CopyOrderNumber orderNumber={detail.order.orderNumber} />
      </header>
      <AdminOrderDetail detail={detail} paymentSummary={paymentSummary} />
    </section>
  );
}
