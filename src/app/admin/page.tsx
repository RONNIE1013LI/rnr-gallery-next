import Link from "next/link";
import styles from "@/components/admin/admin.module.css";
import { getAdminDashboardRuntime } from "@/server/admin/admin-dashboard-runtime";
import { requireAdminPage } from "@/server/auth/require-admin-page";

const money = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" });
const date = new Intl.DateTimeFormat("en-NZ", { dateStyle: "medium", timeStyle: "short", timeZone: "Pacific/Auckland" });

export const metadata = { title: "Operations | R&R Gallery Admin" };

function status(value: string) {
  return value.replaceAll("_", " ");
}

export default async function AdminDashboardPage() {
  await requireAdminPage("/admin", "access_admin");
  const summary = await getAdminDashboardRuntime().summary();
  const metrics = [
    ["Orders today", summary.metrics.todayOrders],
    ["Awaiting payment", summary.metrics.awaitingPayment],
    ["Paid, awaiting work", summary.metrics.paidAwaitingFulfilment],
    ["Designing", summary.metrics.designing],
    ["Awaiting customer", summary.metrics.awaitingCustomer],
    ["Ready to print", summary.metrics.readyToPrint],
    ["Shipped", summary.metrics.shipped],
    ["Refund / exception", summary.metrics.refundOrException],
  ] as const;

  return (
    <section className={styles.pageSection}>
      <header className={styles.pageHeader}>
        <div>
          <h1>Operations overview</h1>
          <p>Live order, catalogue and provider status. No test records or estimated business data are inserted here.</p>
        </div>
        <Link className={styles.primaryAdminButton} href="/admin/orders">Open orders</Link>
      </header>

      <div className={styles.metricGrid}>
        {metrics.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}
      </div>

      <div className={styles.dashboardGrid}>
        <div className={styles.dashboardAside}>
        <section className={styles.panel}>
          <div className={styles.panelHeading}><h2>Recent orders</h2><Link href="/admin/orders">View all</Link></div>
          {summary.recentOrders.length ? (
            <div className={styles.compactRows}>
              {summary.recentOrders.map((order) => (
                <Link href={`/admin/orders/${order.id}`} key={order.id}>
                  <span><strong>{order.orderNumber}</strong><small>{order.customerEmail}</small></span>
                  <span><strong>{money.format(order.totalInclGstCents / 100)}</strong><small>{status(order.fulfilmentStatus)} · {status(order.paymentStatus)}</small></span>
                  <time>{date.format(order.createdAt)}</time>
                </Link>
              ))}
            </div>
          ) : <p className={styles.mutedText}>No orders have been created yet.</p>}
        </section>
        <section className={styles.panel}>
          <div className={styles.panelHeading}><h2>Needs attention</h2><span>{summary.attentionOrders.length}</span></div>
          {summary.attentionOrders.length ? <div className={styles.compactRows}>{summary.attentionOrders.map((order) => <Link href={`/admin/orders/${order.id}`} key={order.id}><span><strong>{order.orderNumber}</strong><small>{order.customerEmail}</small></span><span><strong>{status(order.fulfilmentStatus)}</strong><small>{status(order.paymentStatus)}</small></span><time>{date.format(order.createdAt)}</time></Link>)}</div> : <p className={styles.mutedText}>No urgent, on-hold, failed-payment or customer-waiting orders.</p>}
        </section>
        </div>

        <div className={styles.dashboardAside}>
          <section className={styles.panel}>
            <h2>Store records</h2>
            <dl className={styles.stackedDefinitionList}>
              <div><dt>All orders</dt><dd>{summary.metrics.totalOrders}</dd></div>
              <div><dt>Open / urgent</dt><dd>{summary.metrics.openOrders} / {summary.metrics.urgentOrders}</dd></div>
              <div><dt>Paid revenue incl GST</dt><dd>{money.format(summary.metrics.paidRevenueInclGstCents / 100)}</dd></div>
              <div><dt>Products</dt><dd>{summary.catalogue.productCount}</dd></div>
              <div><dt>Published / featured</dt><dd>{summary.catalogue.publishedProducts} / {summary.catalogue.featuredProducts}</dd></div>
              <div><dt>Active gallery designs</dt><dd>{summary.catalogue.activeGalleryDesigns}</dd></div>
              <div><dt>Customer accounts</dt><dd>{summary.catalogue.customerCount}</dd></div>
            </dl>
          </section>
          <section className={styles.panel}>
            <h2>Provider readiness</h2>
            <div className={styles.providerList}>
              {summary.paymentProviders.map((provider) => <div key={provider.label}><span><strong>{provider.label}</strong><small>{provider.environment}</small></span><b data-enabled={provider.enabled}>{provider.enabled ? "Available" : "Unavailable"}</b></div>)}
              <div><span><strong>{summary.shippingProvider.label}</strong><small>{summary.shippingProvider.environment}</small></span><b data-enabled={summary.shippingProvider.enabled}>{summary.shippingProvider.enabled ? "Available" : "Unavailable"}</b></div>
            </div>
          </section>
          <section className={styles.panel}>
            <h2>Production &amp; delivery</h2>
            <div className={styles.deliveryNotes}><p>{summary.deliveryTimes.production}</p><p>{summary.deliveryTimes.nz}</p><p>{summary.deliveryTimes.au}</p></div>
          </section>
        </div>
      </div>
    </section>
  );
}
