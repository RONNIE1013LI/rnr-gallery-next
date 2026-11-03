import Link from "next/link";
import type { UserShoppingHistory } from "@/server/analytics/user-shopping-history";
import styles from "./admin.module.css";

const timestamp = new Intl.DateTimeFormat("en-NZ", {
  timeZone: "Pacific/Auckland", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
});
const money = (cents: number, currency: string) => new Intl.NumberFormat("en-NZ", { style: "currency", currency, currencyDisplay: "code" }).format(cents / 100);

export function UserShoppingHistoryPanel({ history }: Readonly<{ history: UserShoppingHistory }>) {
  return <section className={styles.panel} aria-labelledby="shopping-history-heading">
    <h2 id="shopping-history-heading">Browsing &amp; shopping history</h2>
    <p className={styles.mutedText}>Latest 90 days · New Zealand time (Pacific/Auckland). Browsing and cart activity require sign-in and analytics consent. Earlier anonymous activity is not linked to this account.</p>
    <p className={styles.mutedText}>Cart amounts are browser estimates. Submitted orders come from account order records; submission does not mean payment was completed. Changes are inferred only from consecutive recorded cart snapshots.</p>
    {history.status === "unavailable" ? <p role="alert">Activity history is temporarily unavailable. Please try again later.</p>
      : history.events.length === 0 ? <p>No linked activity recorded in the last 90 days.</p>
      : <>
        <ol className={styles.userActivityList}>
          {history.events.map(event => <li key={`${event.kind}:${event.id}`}>
            <time dateTime={event.occurredAt}>{timestamp.format(new Date(event.occurredAt))}</time>
            <div>
              {event.kind === "pageview" ? <><strong>Page viewed</strong><Link href={event.pathname} target="_blank" rel="noopener noreferrer">{event.pathname}</Link></>
                : event.kind === "order" ? <><strong>Order submitted: {event.orderNumber}</strong><p>{money(event.totalInclGstCents, event.currency)} · Current payment status: {event.paymentStatus.replaceAll("_", " ")}</p></>
                : <>
                  <strong>{event.kind === "checkout" ? "Checkout cart recorded" : "Cart recorded"}</strong>
                  {event.changes.length ? <ul>{event.changes.map((change, index) => <li key={index}>{change}</li>)}</ul> : null}
                  <p>Estimate: {money(event.totalInclGstCents, event.currency)} · {event.items.reduce((sum, item) => sum + item.quantity, 0)} item(s)</p>
                  {event.items.length ? <ul>{event.items.map((item, index) => <li key={index}>{item.productTitle}{item.sizeLabel ? ` (${item.sizeLabel})` : ""} × {item.quantity}</li>)}</ul> : <p>Cart empty</p>}
                </>}
            </div>
          </li>)}
        </ol>
        {history.hasMore ? <p className={styles.mutedText}>Showing the latest 200 recorded events.</p> : null}
      </>}
  </section>;
}
