"use client";

import Image from "next/image";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import {
  createBrowserCartRepository,
  parseStoredCart,
} from "@/domain/cart/browser-cart-repository";
import {
  EMPTY_CART_JSON,
  getCartSnapshot,
  notifyCartChanged,
  subscribeToCart,
} from "@/domain/cart/browser-cart-events";
import {
  calculateCartTotals,
  removeCartItem,
  setCartItemQuantity,
} from "@/domain/cart/cart";
import type { Cart } from "@/domain/cart/types";
import { formatNzd } from "@/domain/money";
import styles from "./storefront.module.css";

function saveCart(cart: Cart) {
  createBrowserCartRepository(window.localStorage).save(cart);
  notifyCartChanged();
}

function labelFor(value: string): string {
  const labels: Record<string, string> = {
    upload: "Upload on this page",
    later: "Send after ordering",
    landscape: "Landscape",
    portrait: "Portrait",
    post: "Post",
    pickup: "Pickup",
  };
  return labels[value] ?? value;
}

export function CartView() {
  const snapshot = useSyncExternalStore(
    subscribeToCart,
    getCartSnapshot,
    () => EMPTY_CART_JSON,
  );
  const cart = parseStoredCart(snapshot);
  const totals = calculateCartTotals(cart);

  if (cart.items.length === 0) {
    return (
      <section className={styles.cartEmpty}>
        <p className={styles.eyebrow}>Your order</p>
        <h1>Your cart is empty</h1>
        <p>Choose a custom product to begin creating your artwork.</p>
        <Link className={styles.primaryButton} href="/shop">Explore products</Link>
      </section>
    );
  }

  return (
    <div className={styles.cartLayout}>
      <section className={styles.cartItems} aria-label="Cart items">
        {cart.items.map((item) => (
          <article className={styles.cartItem} key={item.id}>
            <button
              className={styles.removeItem}
              type="button"
              aria-label={`Remove ${item.productTitle}`}
              onClick={() => saveCart(removeCartItem(cart, item.id))}
            >×</button>
            <div className={styles.cartItemMedia}>
              <Image src={item.imageSrc} alt="" fill sizes="96px" />
            </div>
            <div className={styles.cartItemDetails}>
              <h2>{item.productTitle}</h2>
              <dl>
                <div><dt>Size</dt><dd>{item.sizeLabel}</dd></div>
                {item.orientation && <div><dt>Orientation</dt><dd>{labelFor(item.orientation)}</dd></div>}
                {item.peoplePets > 0 && <div><dt>People / pets</dt><dd>{item.peoplePets}</dd></div>}
                <div><dt>Photo submission</dt><dd>{labelFor(item.photoSubmissionMethod)}</dd></div>
                <div><dt>Needed by</dt><dd>{item.neededDate}</dd></div>
                <div><dt>Delivery</dt><dd>{labelFor(item.deliveryPreference)}</dd></div>
              </dl>
            </div>
            <div className={styles.cartItemActions}>
              <label>
                <span>Quantity</span>
                <select
                  aria-label={`Quantity for ${item.productTitle}`}
                  value={item.quantity}
                  onChange={(event) =>
                    saveCart(
                      setCartItemQuantity(cart, item.id, Number(event.target.value)),
                    )
                  }
                >
                  {[1, 2, 3, 4, 5].map((quantity) => (
                    <option key={quantity} value={quantity}>{quantity}</option>
                  ))}
                </select>
              </label>
            </div>
          </article>
        ))}
        <Link className={styles.secondaryButton} href="/shop">Continue shopping</Link>
      </section>

      <aside className={styles.cartTotals} aria-label="Cart totals">
        <p className={styles.eyebrow}>Order total</p>
        <h2>Cart summary</h2>
        <dl className={styles.priceLines}>
          <div><dt>Subtotal ex GST</dt><dd>{formatNzd(totals.subtotalExGstCents)}</dd></div>
          <div><dt>GST (15%)</dt><dd>{formatNzd(totals.gstCents)}</dd></div>
          <div className={styles.priceTotal}><dt>Total incl GST</dt><dd>{formatNzd(totals.totalInclGstCents)}</dd></div>
        </dl>
        <Link className={styles.primaryButton} href="/checkout">Continue to checkout</Link>
        <p className={styles.cartAssurance}>Draft approval comes before production.</p>
      </aside>
    </div>
  );
}
