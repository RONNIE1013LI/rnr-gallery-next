import type { RepricedCheckoutCart } from "@/domain/checkout/types";
import { formatNzd } from "@/domain/money";
import type { PublicShippingDTO } from "@/server/checkout/public-dto";
import styles from "./storefront.module.css";

export function CheckoutOrderSummary({ cart, shipping }: {
  cart: RepricedCheckoutCart | null;
  shipping: PublicShippingDTO["option"] | null;
}) {
  if (!cart) return <p>Review delivery to see authoritative totals.</p>;
  const shippingEx = shipping?.amountExGstCents ?? 0;
  const shippingGst = shipping?.gstCents ?? 0;
  const shippingTotal = shipping?.amountInclGstCents ?? 0;
  return (
    <>
      {cart.items.map((item) => (
        <div className={styles.checkoutProduct} key={item.clientItemId}>
          {item.galleryDesign && (
            <Image
              src={item.galleryDesign.imageUrl}
              alt={item.galleryDesign.title}
              width={64}
              height={64}
              unoptimized
            />
          )}
          <div>
            <strong>{item.productTitle} × {item.quantity}</strong>
            <span>{item.sizeLabel}</span>
            {item.galleryDesign && <small>{item.galleryDesign.title}</small>}
          </div>
        </div>
      ))}
      <dl className={styles.priceLines}>
        <div><dt>Subtotal ex GST</dt><dd>{formatNzd(cart.subtotalExGstCents)}</dd></div>
        <div><dt>GST</dt><dd>{formatNzd(cart.gstCents + shippingGst)}</dd></div>
        <div><dt>Shipping ex GST</dt><dd>{formatNzd(shippingEx)}</dd></div>
        <div className={styles.priceTotal}><dt>Total incl GST</dt><dd>{formatNzd(cart.totalInclGstCents + shippingTotal)}</dd></div>
      </dl>
      {shipping ? <p className={styles.checkoutProvenance}>{shipping.serviceName} · {shipping.method === "pickup" ? "No shipping charge" : shipping.isTest ? "Test rate — not a live carrier rate" : "Live carrier rate"}</p> : null}
    </>
  );
}
import Image from "next/image";
