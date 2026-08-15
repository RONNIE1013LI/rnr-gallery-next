import Image from "next/image";
import type { RepricedCheckoutCart } from "@/domain/checkout/types";
import { formatNzd } from "@/domain/money";
import { normalizeShippingServiceName } from "@/domain/shipping/service-name";
import type { PublicShippingDTO } from "@/server/checkout/public-dto";
import styles from "./storefront.module.css";

function shippingDisclosure(shipping: PublicShippingDTO["option"]) {
  if (shipping.method === "pickup") return `${shipping.serviceName} · No shipping charge`;
  const serviceName = normalizeShippingServiceName(shipping.serviceName).replace(/\s*—\s*not a live carrier rate$/i, "");
  return `${serviceName} · ${shipping.isTest ? "Test rate — not a live carrier rate" : "Live carrier rate"}`;
}

export function CheckoutOrderSummary({ cart, shipping }: {
  cart: RepricedCheckoutCart | null;
  shipping: PublicShippingDTO["option"] | null;
}) {
  if (!cart) return <p>Review delivery to see authoritative totals.</p>;
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
        <div><dt>Products incl GST</dt><dd>{formatNzd(cart.totalInclGstCents)}</dd></div>
        <div><dt>Shipping incl GST</dt><dd>{formatNzd(shippingTotal)}</dd></div>
        <div><dt>Includes GST</dt><dd>{formatNzd(cart.gstCents + shippingGst)}</dd></div>
        <div className={styles.priceTotal}><dt>Total incl GST</dt><dd>{formatNzd(cart.totalInclGstCents + shippingTotal)}</dd></div>
      </dl>
      {shipping ? <p className={styles.checkoutProvenance}>{shippingDisclosure(shipping)}</p> : null}
    </>
  );
}
