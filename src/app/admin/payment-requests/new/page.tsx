import Link from "next/link";
import { PaymentRequestForm } from "@/components/admin/payment-request-form";
import styles from "@/components/admin/admin.module.css";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import { getPaymentRequestRuntime } from "@/server/payment-requests/payment-request-runtime";
import type { PaymentMethodKey } from "@/server/db/schema/payments";
import { parsePaymentConfig } from "@/server/payments/config";

type Props = Readonly<{ searchParams?: Promise<{ orderId?: string | string[] }> }>;

export default async function NewPaymentRequestPage({ searchParams = Promise.resolve({}) }: Props) {
  const query = await searchParams;
  const orderId = typeof query.orderId === "string" ? query.orderId : null;
  const requestedPath = orderId
    ? `/admin/payment-requests/new?orderId=${encodeURIComponent(orderId)}`
    : "/admin/payment-requests/new";
  await requireAdminPage(requestedPath, "manage_payment");
  const summary = orderId ? await getPaymentRequestRuntime().orderSummary(orderId) : null;
  const paymentConfig = parsePaymentConfig();
  const preferredMethods = Object.freeze(
    (["afterpay", "card"] as const).filter((method): method is PaymentMethodKey => {
      if (method === "card") return paymentConfig.stripe.enabled || paymentConfig.localTest.enabled;
      return paymentConfig.afterpay.enabled || paymentConfig.localTest.enabled;
    }),
  );
  return <section className={`${styles.pageSection} ${styles.narrowPage}`}>
    <header className={styles.pageHeader}><div><nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><Link href="/admin/payment-requests">Payment Requests</Link><span>/</span><span>New</span></nav><h1>New Payment Request</h1><p>{summary ? `Collect a fixed outstanding amount for Order ${summary.orderNumber}.` : "Create a fixed standalone payment request."}</p></div></header>
    {summary && summary.unreservedCents <= 0
      ? <div className={styles.safetyBanner} role="note"><strong>No unreserved outstanding balance</strong><p>This Order cannot accept another Payment Request at the moment.</p></div>
      : <PaymentRequestForm
        linkedOrder={summary ? { id: summary.orderId, orderNumber: summary.orderNumber, currency: summary.currency, unreservedCents: summary.unreservedCents } : undefined}
        preferredMethods={preferredMethods}
      />}
  </section>;
}
