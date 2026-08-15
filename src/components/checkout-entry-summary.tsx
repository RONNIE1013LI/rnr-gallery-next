"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import { parseStoredCart } from "@/domain/cart/browser-cart-repository";
import {
  EMPTY_CART_JSON,
  getCartSnapshot,
  subscribeToCart,
} from "@/domain/cart/browser-cart-events";
import { calculateCartTotals } from "@/domain/cart/cart";
import { formatNzd } from "@/domain/money";

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
                </div>
                <span>Qty {item.quantity}</span>
              </li>
            ))}
          </ul>

          <dl className={styles.checkoutEntryTotals}>
            <div>
              <dt>Subtotal incl GST</dt>
              <dd>{formatNzd(totals.totalInclGstCents)}</dd>
            </div>
            <div>
              <dt>Includes GST (15%)</dt>
              <dd>{formatNzd(totals.gstCents)}</dd>
            </div>
            <div className={styles.checkoutEntryTotal}>
              <dt>Total incl GST</dt>
              <dd>{formatNzd(totals.totalInclGstCents)}</dd>
            </div>
          </dl>
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
