"use client";

import Link from "next/link";
import type { WebsiteAnalyticsV2OrdersData } from "./website-analytics-v2-dashboard";
import { formatAnalyticsMoney } from "./website-analytics-v2-charts";
import adminStyles from "./admin.module.css";
import styles from "./website-analytics-v2.module.css";

const orderSorts = [
  ["occurred_at_desc", "Newest first"],
  ["occurred_at_asc", "Oldest first"],
  ["ordered_amount_desc", "Ordered amount: high to low"],
  ["ordered_amount_asc", "Ordered amount: low to high"],
  ["collected_amount_desc", "Collected amount: high to low"],
  ["refunded_amount_desc", "Refunded amount: high to low"],
] as const;

function queryWith(
  canonicalQuery: string,
  values: Readonly<Record<string, string | number>>,
) {
  const query = new URLSearchParams(canonicalQuery);
  for (const [key, value] of Object.entries(values)) query.set(key, String(value));
  return query.toString();
}

function titleCase(value: string) {
  return value.split("_").map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ");
}

export function WebsiteAnalyticsV2Orders({
  canonicalQuery,
  loading,
  onNavigate,
  orders,
}: Readonly<{
  canonicalQuery: string;
  loading: boolean;
  onNavigate: (query: string) => void;
  orders: WebsiteAnalyticsV2OrdersData;
}>) {
  const query = new URLSearchParams(canonicalQuery);
  const sort = query.get("sort") ?? "occurred_at_desc";
  const shownPage = orders.pageCount === 0 ? 0 : orders.page;
  const pageSizes = [...new Set([10, 25, 50, 100, orders.pageSize])].sort((left, right) => left - right);

  return <section className={`${adminStyles.panel} ${styles.ordersPanel}`}>
    <div className={styles.ordersHeading}>
      <div>
        <h2>Orders</h2>
        <p>{orders.total} matching {orders.total === 1 ? "order" : "orders"}</p>
      </div>
      <div className={styles.orderControls}>
        <label>
          Sort orders
          <select
            disabled={loading}
            value={sort}
            onChange={(event) => onNavigate(queryWith(canonicalQuery, {
              sort: event.target.value,
              page: 1,
            }))}
          >
            {orderSorts.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          Orders per page
          <select
            disabled={loading}
            value={String(orders.pageSize)}
            onChange={(event) => onNavigate(queryWith(canonicalQuery, {
              pageSize: event.target.value,
              page: 1,
            }))}
          >
            {pageSizes.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>
    </div>

    {orders.items.length === 0
      ? <p className={styles.muted}>No orders match these filters.</p>
      : <div className={styles.orderTableScroller} tabIndex={0}>
        <table className={`${styles.dataTable} ${styles.orderTable}`} aria-label="Analytics orders">
          <thead><tr>
            <th scope="col">Reference</th>
            <th scope="col">Date</th>
            <th scope="col">Source</th>
            <th scope="col">Market</th>
            <th scope="col">Ordered</th>
            <th scope="col">Collected</th>
            <th scope="col">Refunded</th>
            <th scope="col">Net collected</th>
            <th scope="col">Payment</th>
            <th scope="col">Channel</th>
            <th scope="col">Attribution</th>
          </tr></thead>
          <tbody>{orders.items.map((order) => <tr key={order.conversionId}>
            <th scope="row">
              {order.adminHref
                ? <Link href={order.adminHref}>{order.reference}</Link>
                : order.reference}
              {order.historical ? <small className={styles.historical}>Historical</small> : null}
            </th>
            <td><time dateTime={order.occurredAt}>{order.localDate}</time></td>
            <td>{titleCase(order.source)}</td>
            <td>{order.market}</td>
            <td>{formatAnalyticsMoney(order.currency, order.orderedAmountCents)}</td>
            <td>{formatAnalyticsMoney(order.currency, order.collectedAmountCents)}</td>
            <td>{formatAnalyticsMoney(order.currency, order.refundedAmountCents)}</td>
            <td>{formatAnalyticsMoney(order.currency, order.netCollectedAmountCents)}</td>
            <td>{titleCase(order.paymentStatus)}</td>
            <td>{order.attribution.channel}</td>
            <td>{[order.attribution.source, order.attribution.medium, order.attribution.campaign].join(" / ")}</td>
          </tr>)}</tbody>
        </table>
      </div>}

    <nav className={styles.pagination} aria-label="Analytics orders pagination">
      <button
        aria-label="Previous orders page"
        disabled={loading || orders.page <= 1 || orders.pageCount === 0}
        type="button"
        onClick={() => onNavigate(queryWith(canonicalQuery, { page: orders.page - 1 }))}
      >Previous</button>
      <span>Page {shownPage} of {orders.pageCount}</span>
      <button
        aria-label="Next orders page"
        disabled={loading || orders.page >= orders.pageCount}
        type="button"
        onClick={() => onNavigate(queryWith(canonicalQuery, { page: orders.page + 1 }))}
      >Next</button>
    </nav>
  </section>;
}
