import { formatNzd } from "@/domain/money";
import type { PublicOrder } from "@/server/orders/order-query-service";
import styles from "./storefront.module.css";

const statusLabels = { awaiting_payment: "Awaiting payment setup", processing: "Payment processing", paid: "Paid", failed: "Payment failed", cancelled: "Cancelled", refunded: "Refunded" } as const;
function Address({ value }: { value: PublicOrder["addresses"]["billing"] }) { return <address>{value.fullName}<br />{value.building ? <>{value.building}<br /></> : null}{value.street}<br />{value.suburb}, {value.region} {value.postcode}<br />{value.country}<br />{value.phone}<br />{value.email}</address>; }

export function OrderDetail({ order }: { order: PublicOrder }) {
  return <article className={styles.orderDetail}>
    <header><p className={styles.eyebrow}>Order {order.orderNumber}</p><h1>Order confirmed.</h1><p>{statusLabels[order.paymentStatus]} · {new Intl.DateTimeFormat("en-NZ", { dateStyle: "long" }).format(new Date(order.createdAt))}</p></header>
    <div className={styles.orderDetailGrid}><section><h2>Items</h2>{order.items.map((item, index) => <article className={styles.orderItemSnapshot} key={`${item.productTitle}-${index}`}><h3>{item.productTitle} × {item.quantity}</h3><dl><div><dt>Size</dt><dd>{item.sizeLabel}</dd></div>{item.orientation ? <div><dt>Orientation</dt><dd>{item.orientation}</dd></div> : null}{item.peoplePets ? <div><dt>People / pets</dt><dd>{item.peoplePets}</dd></div> : null}<div><dt>Needed by</dt><dd>{item.neededDate}</dd></div><div><dt>Line total incl GST</dt><dd>{formatNzd(item.lineTotalInclGstCents)}</dd></div></dl></article>)}</section><aside className={styles.orderTotals}><h2>Order summary</h2><dl className={styles.priceLines}><div><dt>Products ex GST</dt><dd>{formatNzd(order.totals.productSubtotalExGstCents)}</dd></div><div><dt>Shipping ex GST</dt><dd>{formatNzd(order.shipping.amountExGstCents)}</dd></div><div><dt>GST</dt><dd>{formatNzd(order.totals.totalGstCents)}</dd></div><div className={styles.priceTotal}><dt>Total incl GST</dt><dd>{formatNzd(order.totals.totalInclGstCents)}</dd></div></dl><p>{order.deliveryMethod === "pickup" ? "Pickup · No shipping charge" : `${order.shipping.serviceName} · ${order.shipping.isTest ? "Test rate — not a live carrier rate" : "Live carrier rate"}`}</p></aside></div>
    <div className={styles.orderAddresses}><section><h2>Billing address</h2><Address value={order.addresses.billing} /></section><section><h2>Delivery address</h2><Address value={order.addresses.delivery} /></section></div>
  </article>;
}
