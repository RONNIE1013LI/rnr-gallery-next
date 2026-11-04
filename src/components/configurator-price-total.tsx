import { formatMarketMoney } from "@/domain/money";
import styles from "./storefront.module.css";

export function ConfiguratorPriceTotal({ totalCents, firstOrderTotalCents, currency, taxRegistered }: Readonly<{
  totalCents: number;
  firstOrderTotalCents: number | null;
  currency: "NZD" | "AUD";
  taxRegistered: boolean;
}>) {
  const showOffer = firstOrderTotalCents !== null;
  return <div className={`${styles.priceTotal}${showOffer ? ` ${styles.configuratorOfferTotal}` : ""}`}>
    <dt>{taxRegistered ? "Total incl GST" : "Total"}{showOffer ? <small className={styles.configuratorOfferLabel}>Promotional price</small> : null}</dt>
    <dd className={showOffer ? styles.configuratorOfferPrices : undefined}>
      {showOffer ? <strong className={styles.configuratorOfferPrice}>20% OFF · now {formatMarketMoney(firstOrderTotalCents, currency)}</strong> : null}
      <span className={showOffer ? styles.configuratorOriginalPrice : undefined}>{formatMarketMoney(totalCents, currency)}</span>
      {showOffer ? <small className={styles.configuratorOfferTerms}>20% off every order during this promotion, automatically applied in your cart. Shipping and urgent fees are excluded.</small> : null}
    </dd>
  </div>;
}
