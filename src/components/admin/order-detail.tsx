import { AdminOrderActions } from "./order-actions";
import type { getAdminOrderDetail } from "@/server/admin/drizzle-admin-order-repository";
import { formatMarketMoney } from "@/domain/money";
import styles from "./admin.module.css";

type Detail = NonNullable<Awaited<ReturnType<typeof getAdminOrderDetail>>>;

const dateTime = new Intl.DateTimeFormat("en-NZ", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Pacific/Auckland",
});

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function addressLines(address: Detail["addresses"][number]) {
  return [
    address.fullName,
    address.building,
    address.street,
    address.suburb,
    `${address.region} ${address.postcode}`.trim(),
    address.country,
  ].filter(Boolean);
}

export function AdminOrderDetail({ detail }: Readonly<{ detail: Detail }>) {
  const { order } = detail;
  const amount = (cents: number) => formatMarketMoney(cents, order.currency);
  return (
    <div className={styles.orderDetailLayout}>
      <div className={styles.detailMain}>
        <section className={styles.summaryGrid}>
          <div><span>Payment</span><strong>{label(order.paymentStatus)}</strong></div>
          <div><span>Order status</span><strong>{label(order.fulfilmentStatus)}</strong></div>
          <div><span>Delivery</span><strong>{label(order.deliveryMethod)}</strong></div>
          <div><span>Total</span><strong>{amount(order.totalInclGstCents)}</strong></div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <h2>Items</h2>
            <span>Original price snapshot — read only</span>
          </div>
          {detail.items.map((item) => (
            <article className={styles.orderItem} key={item.id}>
              <div className={styles.orderItemHeading}>
                <div>
                  <h3>{item.productTitle}</h3>
                  <p>
                    {item.productKey === "grave-cover" ? "100 × 200 cm" : item.sizeLabel}
                    {item.productKey !== "grave-cover" && item.orientation
                      ? ` · ${label(item.orientation)}`
                      : ""}
                  </p>
                </div>
                <strong>{amount(item.lineTotalInclGstCents)}</strong>
              </div>
              <dl className={styles.definitionGrid}>
                <div><dt>Quantity</dt><dd>{item.quantity}</dd></div>
                <div><dt>People / pets</dt><dd>{item.peoplePets}</dd></div>
                <div><dt>Photo submission</dt><dd>{label(item.photoSubmissionMethod)}</dd></div>
                <div><dt>Needed date</dt><dd>{item.neededDate}</dd></div>
                <div><dt>Urgent</dt><dd>{item.urgentServiceConfirmed ? `Yes · ${item.urgentWorkingDays} working days` : "No"}</dd></div>
              </dl>
              {item.designText ? <div className={styles.customerText}><strong>Artwork direction</strong><p>{item.designText}</p></div> : null}
              {item.notes ? <div className={styles.customerText}><strong>Customer notes</strong><p>{item.notes}</p></div> : null}
              <div className={styles.priceLines}>
                {item.priceLines.map((line) => (
                  <div key={line.key}><span>{line.label}</span><strong>{amount(line.amountExGstCents)}</strong></div>
                ))}
                <div><span>Line GST</span><strong>{amount(item.lineGstCents)}</strong></div>
              </div>
              <div className={styles.uploadList}>
                <strong>Uploads</strong>
                {detail.uploads.filter((upload) => upload.orderItemId === item.id).length ? (
                  <ul>
                    {detail.uploads.filter((upload) => upload.orderItemId === item.id).map((upload) => (
                      <li key={upload.id}>
                        <span><strong>{upload.originalName}</strong><span className={styles.uploadActions}><a href={`/api/admin/uploads/${upload.id}`} target="_blank" rel="noopener noreferrer">View</a><a href={`/api/admin/uploads/${upload.id}?download=1`}>Download</a></span></span>
                        <small>{upload.mediaType} · {(upload.sizeBytes / 1024 / 1024).toFixed(1)} MB</small>
                      </li>
                    ))}
                  </ul>
                ) : <p>No uploaded files for this item.</p>}
              </div>
            </article>
          ))}
        </section>

        <section className={styles.twoColumnPanels}>
          {detail.addresses.map((address) => (
            <article className={styles.panel} key={address.kind}>
              <h2>{label(address.kind)} address</h2>
              <address>{addressLines(address).map((line) => <span key={line}>{line}</span>)}</address>
              <p>{address.phone}<br />{address.email}</p>
            </article>
          ))}
        </section>

        <section className={styles.panel}>
          <h2>Shipping</h2>
          <dl className={styles.definitionGrid}>
            <div><dt>Service</dt><dd>{order.shippingServiceName}</dd></div>
            <div><dt>Provider</dt><dd>{order.shippingProvider ? label(order.shippingProvider) : "Pickup"}</dd></div>
            <div><dt>Shipping total</dt><dd>{amount(order.shippingTotalInclGstCents)}</dd></div>
            <div><dt>Tracking</dt><dd>{order.trackingNumber ?? "Not added"}</dd></div>
          </dl>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}><h2>Order totals</h2><span>Immutable checkout snapshot</span></div>
          <div className={styles.orderTotals}>
            <div><span>Products ex GST</span><strong>{amount(order.productSubtotalExGstCents)}</strong></div>
            <div><span>Product GST</span><strong>{amount(order.productGstCents)}</strong></div>
            <div><span>Shipping ex GST</span><strong>{amount(order.shippingExGstCents)}</strong></div>
            <div><span>Shipping GST</span><strong>{amount(order.shippingGstCents)}</strong></div>
            <div><span>Subtotal ex GST</span><strong>{amount(order.totalExGstCents)}</strong></div>
            <div><span>Total GST</span><strong>{amount(order.totalGstCents)}</strong></div>
            <div><span>Total incl GST</span><strong>{amount(order.totalInclGstCents)}</strong></div>
          </div>
        </section>

        <section className={styles.panel}>
          <h2>Payment records</h2>
          <p className={styles.safetyNotice}>Payment status is controlled by payment events. This page does not charge, refund, or override the provider.</p>
          {detail.payments.length ? (
            <div className={styles.timeline}>
              {detail.payments.map((payment) => (
                <article key={payment.id}>
                  <strong>{label(payment.method)} · {label(payment.status)}</strong>
                  <span>{label(payment.provider)} · {amount(payment.expectedAmountCents)}</span>
                  <small>{dateTime.format(payment.createdAt)}</small>
                </article>
              ))}
            </div>
          ) : <p>No payment attempts recorded.</p>}
        </section>

        <section className={styles.panel}>
          <h2>Notes</h2>
          {detail.notes.length ? <div className={styles.timeline}>{detail.notes.map((note) => (
            <article key={note.id}>
              <strong>{label(note.visibility)}</strong>
              <span>{note.body}</span>
              <small>{note.authorEmail ?? "Former administrator"} · {dateTime.format(note.createdAt)}</small>
            </article>
          ))}</div> : <p>No notes have been added.</p>}
        </section>

        <section className={styles.panel}>
          <h2>Status history</h2>
          {detail.history.length ? <div className={styles.timeline}>{detail.history.map((entry) => (
            <article key={entry.id}>
              <strong>{label(entry.fromStatus)} → {label(entry.toStatus)}</strong>
              {entry.reason ? <span>{entry.reason}</span> : null}
              <small>{entry.actorEmail ?? "System"} · {dateTime.format(entry.createdAt)}</small>
            </article>
          ))}</div> : <p>No status changes recorded yet.</p>}
        </section>
      </div>

      <aside className={styles.detailAside}>
        <AdminOrderActions
          orderId={order.id}
          currentStatus={order.fulfilmentStatus}
          tracking={{
            carrier: order.trackingCarrier,
            number: order.trackingNumber,
            url: order.trackingUrl,
          }}
        />
      </aside>
    </div>
  );
}
