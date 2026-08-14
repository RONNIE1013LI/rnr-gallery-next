import Image from "next/image";
import { formatNzd } from "@/domain/money";
import { normalizeShippingServiceName } from "@/domain/shipping/service-name";
import type { PublicOrder } from "@/server/orders/order-query-service";
import styles from "./storefront.module.css";

export const orderPaymentStatusLabels = { awaiting_payment: "Payment required", processing: "Payment processing", paid: "Paid", failed: "Payment failed", cancelled: "Payment cancelled", refunded: "Refunded" } as const;
export const orderFulfilmentStatusLabels = { new: "Order confirmed", designing: "Artwork in progress", awaiting_customer: "Awaiting your design approval", ready_to_print: "Approved for production", printing: "In production", on_hold: "On hold", shipped: "Shipped", completed: "Completed", cancelled: "Cancelled" } as const;
const paymentMethodLabels = { card: "Card", afterpay: "Afterpay", zip: "Zip" } as const;
const paymentAttemptStatusLabels = { created: "Setup pending", requires_action: "Action required", processing: "In progress", paid: "Paid", failed: "Failed", cancelled: "Cancelled", refunded: "Refunded" } as const;
const customerOrderHeadings = { awaiting_payment: "Complete your payment.", processing: "Payment is processing.", paid: "Order confirmed.", failed: "Payment wasn’t completed.", cancelled: "Payment was cancelled.", refunded: "Order refunded." } as const;
const customerOrderGuidance = { awaiting_payment: "Your order details are saved, but your order will only be confirmed after payment.", processing: "We’re confirming your payment. Please don’t place the order again.", paid: "", failed: "Your order details are saved. Complete payment to confirm your order.", cancelled: "Your order details are saved. Complete payment to confirm your order.", refunded: "This order has been refunded." } as const;
export function customerOrderHeading(status: PublicOrder["paymentStatus"]) { return customerOrderHeadings[status]; }
export function formatOrderDate(value: string) { return new Intl.DateTimeFormat("en-NZ", { dateStyle: "long", timeZone: "Pacific/Auckland" }).format(new Date(value)); }
export function formatShippingDisclosure(order: PublicOrder) {
  if (order.deliveryMethod === "pickup") return "Pickup · No shipping charge";
  const serviceName = normalizeShippingServiceName(order.shipping.serviceName).replace(/\s*—\s*not a live carrier rate$/i, "");
  return `${serviceName} · ${order.shipping.isTest ? "Test rate — not a live carrier rate" : "Live carrier rate"}`;
}
function Address({ value }: { value: PublicOrder["addresses"]["billing"] }) { return <address>{value.fullName}<br />{value.building ? <>{value.building}<br /></> : null}{value.street}<br />{value.suburb}, {value.region} {value.postcode}<br />{value.country}<br />{value.phone}<br />{value.email}</address>; }

function fulfilmentProgress(order: PublicOrder) {
  return order.paymentStatus === "paid" ? orderFulfilmentStatusLabels[order.fulfilmentStatus] : "Details saved";
}

export function OrderDetail({ order, heading = "Order details.", showPaymentGuidance = false }: { order: PublicOrder; heading?: string; showPaymentGuidance?: boolean }) {
  return <article className={styles.orderDetail}>
    <header className={styles.orderHero}><p className={styles.eyebrow}>Order {order.orderNumber}</p><h1>{heading}</h1><p className={styles.orderStatus}>{orderPaymentStatusLabels[order.paymentStatus]} <span aria-hidden="true">·</span> {fulfilmentProgress(order)} <span aria-hidden="true">·</span> {formatOrderDate(order.createdAt)}</p>{showPaymentGuidance && customerOrderGuidance[order.paymentStatus] ? <p className={styles.orderPaymentGuidance}>{customerOrderGuidance[order.paymentStatus]}</p> : null}</header>
    <div className={styles.orderContent}>
      <h2 className={styles.orderItemsHeading}>Items</h2>
      <section className={styles.orderItems}>{order.items.map((item, index) => {
      const chargedLines = item.priceLines.filter((line) => (line.amountInclGstCents ?? line.amountExGstCents) > 0);
      return <article className={styles.orderItemSnapshot} key={`${item.productTitle}-${index}`}><h3>{item.productTitle} × {item.quantity}</h3>{item.galleryDesign ? <div className={styles.gallerySnapshot}><Image src={item.galleryDesign.imageUrl} alt={item.galleryDesign.title} width={88} height={88} unoptimized /><div><strong>Selected design inspiration</strong><span>{item.galleryDesign.title}</span></div></div> : null}<dl><div><dt>Size</dt><dd>{item.sizeLabel}</dd></div>{item.orientation ? <div><dt>Orientation</dt><dd>{item.orientation}</dd></div> : null}{item.peoplePets > 0 ? <div><dt>People / pets</dt><dd>{item.peoplePets}</dd></div> : null}<div><dt>Photo submission</dt><dd>{item.photoSubmissionMethod === "upload" ? "Upload on this page" : "Send after ordering"}</dd></div>{item.designText.trim() ? <div><dt>Design text</dt><dd>{item.designText}</dd></div> : null}{item.notes.trim() ? <div><dt>Design notes</dt><dd>{item.notes}</dd></div> : null}<div><dt>Production completion date</dt><dd>{item.neededDate}</dd></div><div><dt>Urgent service</dt><dd>{item.urgentServiceConfirmed ? `Confirmed · ${item.urgentWorkingDays} working ${item.urgentWorkingDays === 1 ? "day" : "days"}` : "Not requested"}</dd></div></dl>{chargedLines.length ? <><h4>Price breakdown</h4><dl>{chargedLines.map((line) => <div key={line.key}><dt>{line.label}</dt><dd>{formatNzd(line.amountInclGstCents ?? line.amountExGstCents)} {line.amountInclGstCents === undefined ? "ex GST" : "incl GST"}</dd></div>)}</dl></> : null}<dl><div><dt>Line total incl GST</dt><dd>{formatNzd(item.lineTotalInclGstCents)}</dd></div></dl></article>;
      })}</section>
      <aside className={styles.orderTotals}><p className={styles.eyebrow}>Order total</p><h2>Order summary</h2><dl className={styles.priceLines}><div><dt>Products ex GST</dt><dd>{formatNzd(order.totals.productSubtotalExGstCents)}</dd></div><div><dt>Shipping ex GST</dt><dd>{formatNzd(order.shipping.amountExGstCents)}</dd></div><div><dt>GST</dt><dd>{formatNzd(order.totals.totalGstCents)}</dd></div>{order.payment ? <><div><dt>Payment method</dt><dd>{paymentMethodLabels[order.payment.method]}{order.payment.isTest ? " (test)" : ""}</dd></div><div><dt>Payment attempt</dt><dd>{paymentAttemptStatusLabels[order.payment.status]}</dd></div></> : null}<div className={styles.priceTotal}><dt>Total incl GST</dt><dd>{formatNzd(order.totals.totalInclGstCents)}</dd></div></dl><p className={styles.orderShippingDisclosure}>{formatShippingDisclosure(order)}</p></aside>
    </div>
    <div className={styles.orderAddresses}><section><h2>Billing address</h2><Address value={order.addresses.billing} /></section><section><h2>Delivery address</h2><Address value={order.addresses.delivery} /></section></div>
  </article>;
}
