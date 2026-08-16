import Link from "next/link";
import type { AdminOrderListItem } from "@/server/admin/drizzle-admin-order-repository";
import { formatMarketMoney } from "@/domain/money";
import styles from "./admin.module.css";

const dateTime = new Intl.DateTimeFormat("en-NZ", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Pacific/Auckland",
});

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function AdminOrderTable({ orders }: Readonly<{
  orders: readonly AdminOrderListItem[];
}>) {
  if (!orders.length) {
    return (
      <div className={styles.emptyState}>
        <h2>No orders match these filters.</h2>
        <p>Clear the filters or search for a different order.</p>
        <Link href="/admin/orders">Clear filters</Link>
      </div>
    );
  }

  return (
    <div className={styles.tableScroll} tabIndex={0} aria-label="Orders table">
      <table className={styles.dataTable}>
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            <th>Product</th>
            <th>Payment</th>
            <th>Order status</th>
            <th>Delivery</th>
            <th>Total</th>
            <th><span className={styles.visuallyHidden}>Action</span></th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              <td>
                <strong>{order.orderNumber}</strong>
                <small>{dateTime.format(order.createdAt)}</small>
                {order.urgent ? <span className={styles.urgentBadge}>Urgent</span> : null}
              </td>
              <td>
                <strong>{order.customerName}</strong>
                <small>{order.customerEmail}</small>
                <small>{order.country}</small>
              </td>
              <td>{order.productTitles.map((title) => <span key={title}>{title}</span>)}</td>
              <td>
                <span className={styles.statusBadge}>{label(order.paymentStatus)}</span>
                <small>{order.paymentMethod ? label(order.paymentMethod) : "No attempt"}</small>
              </td>
              <td><span className={styles.statusBadge}>{label(order.fulfilmentStatus)}</span></td>
              <td>{label(order.deliveryMethod)}</td>
              <td className={styles.numeric}>{formatMarketMoney(order.totalInclGstCents, order.currency)}</td>
              <td>
                <Link
                  className={styles.tableAction}
                  href={`/admin/orders/${order.id}`}
                  aria-label={`Open ${order.orderNumber}`}
                >
                  Open
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
