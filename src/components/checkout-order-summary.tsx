import Image from "next/image";
import type { RepricedCheckoutCart } from "@/domain/checkout/types";
import { formatMarketMoney } from "@/domain/money";
import { normalizeShippingServiceName } from "@/domain/shipping/service-name";
import type { PublicShippingDTO } from "@/server/checkout/public-dto";
import styles from "./storefront.module.css";

function shippingDisclosure(shipping: PublicShippingDTO["option"]) {
  if (shipping.method === "pickup") return `${shipping.serviceName} · No shipping charge`;
  if (shipping.provenance === "internal-fixed") return `${shipping.serviceName} · Fixed Australian delivery`;
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
  const currency = cart.currency ?? "NZD";
  const taxJurisdiction = cart.taxJurisdiction ?? "NZ_GST";
  const hasTax = taxJurisdiction !== "NONE";
  const taxName = taxJurisdiction === "AU_GST" ? "Australian GST" : "GST";
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
            {item.bundleComponents?.map((component) => {
              const componentLabel = component.componentKey === "roll-up"
                ? "Roll-Up Banner"
                : "Wall Banner";
              const photoCount = component.uploadReferences.length;
              return <dl
                aria-label={`${componentLabel} customisation summary`}
                key={component.componentKey}
              >
                <div><dt>Component</dt><dd>{componentLabel}</dd></div>
                <div><dt>Photo method</dt><dd>{component.photoSubmissionMethod === "upload" ? "Upload Now" : "Send Later"}</dd></div>
                <div><dt>Photos</dt><dd>{photoCount} {photoCount === 1 ? "photo" : "photos"}</dd></div>
                <div><dt>Additional background removal: </dt><dd>{component.extraBackgroundRemovalUploadIds?.length ? "Yes" : "No"}</dd></div>
              </dl>;
            })}
          </div>
        </div>
      ))}
      <dl className={styles.priceLines}>
        <div><dt>{hasTax ? "Products incl GST" : "Products"}</dt><dd>{formatMarketMoney(cart.totalInclGstCents, currency)}</dd></div>
        <div><dt>{hasTax ? "Shipping incl GST" : "Shipping"}</dt><dd>{formatMarketMoney(shippingTotal, currency)}</dd></div>
        <div><dt>{hasTax ? `Includes ${taxName}` : "GST not charged"}</dt><dd>{formatMarketMoney(cart.gstCents + shippingGst, currency)}</dd></div>
        <div className={styles.priceTotal}><dt>{hasTax ? "Total incl GST" : "Total"}</dt><dd>{formatMarketMoney(cart.totalInclGstCents + shippingTotal, currency)}</dd></div>
      </dl>
      {shipping ? <p className={styles.checkoutProvenance}>{shippingDisclosure(shipping)}</p> : null}
    </>
  );
}
