"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import { parseStoredCart } from "@/domain/cart/browser-cart-repository";
import {
  EMPTY_CART_JSON,
  getCartSnapshot,
  subscribeToCart,
} from "@/domain/cart/browser-cart-events";
import { calculateCartTotals, getCartDisplayMarket } from "@/domain/cart/cart";
import { formatMarketMoney } from "@/domain/money";

import styles from "./storefront.module.css";

const subscribeToHydration = () => () => undefined;
const getHydratedSnapshot = () => true;
const getServerHydratedSnapshot = () => false;

export function CheckoutEntrySummary() {
  const isHydrated = useSyncExternalStore(
    subscribeToHydration,
    getHydratedSnapshot,
    getServerHydratedSnapshot,
  );
  const snapshot = useSyncExternalStore(
    subscribeToCart,
    getCartSnapshot,
    () => EMPTY_CART_JSON,
  );
  const cart = parseStoredCart(snapshot);
  const totals = calculateCartTotals(cart);
  const displayMarket = getCartDisplayMarket(cart);

  return (
    <aside
      aria-busy={!isHydrated || undefined}
      aria-labelledby="checkout-entry-summary-title"
      className={styles.checkoutEntrySummary}
    >
      <div className={styles.checkoutEntrySummaryHeader}>
        <div>
          <h2 id="checkout-entry-summary-title">Order summary</h2>
          {totals.itemCount > 0 ? (
            <p>{totals.itemCount} {totals.itemCount === 1 ? "item" : "items"}</p>
          ) : null}
        </div>
        <Link href="/cart">Edit cart</Link>
      </div>

      {!isHydrated ? (
        <div aria-hidden="true" className={styles.checkoutEntryPending}>
          <span />
          <span />
          <span />
        </div>
      ) : cart.items.length > 0 ? (
        <>
          <ul className={styles.checkoutEntryItems}>
            {cart.items.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.productTitle}</strong>
                  <span>{item.sizeLabel}</span>
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
                <span>Qty {item.quantity}</span>
              </li>
            ))}
          </ul>

          {displayMarket ? <dl className={styles.checkoutEntryTotals}>
            <div>
              <dt>{displayMarket.taxJurisdiction === "NONE" ? "Subtotal" : "Subtotal incl GST"}</dt>
              <dd>{formatMarketMoney(totals.totalInclGstCents, displayMarket.currency)}</dd>
            </div>
            {displayMarket.taxJurisdiction !== "NONE" ? <div>
              <dt>{displayMarket.taxJurisdiction === "NZ_GST" ? "Includes GST (15%)" : "Includes Australian GST"}</dt>
              <dd>{formatMarketMoney(totals.gstCents, displayMarket.currency)}</dd>
            </div> : null}
            <div className={styles.checkoutEntryTotal}>
              <dt>{displayMarket.taxJurisdiction === "NONE" ? "Total" : "Total incl GST"}</dt>
              <dd>{formatMarketMoney(totals.totalInclGstCents, displayMarket.currency)}</dd>
            </div>
          </dl> : <p>Prices will be recalculated for the selected delivery country.</p>}
          <p className={styles.checkoutEntryDeliveryNote}>
            Delivery is reviewed after you continue to checkout.
          </p>
        </>
      ) : (
        <p className={styles.checkoutEntryEmpty}>No items are currently saved in this cart.</p>
      )}

      <div className={styles.checkoutEntryTrust}>
        <strong>Secure checkout</strong>
        <span>Payment details are entered after delivery and totals are reviewed.</span>
      </div>
    </aside>
  );
}
