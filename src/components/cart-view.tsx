"use client";

import { CartProductImage } from "./cart-product-image";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { AnalyticsEventTracker } from "@/components/analytics-event-tracker";
import { emitAnalyticsEvent } from "@/domain/analytics/client";
import { buildCartEvent, buildCartItemEvent } from "@/domain/analytics/events";
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
  cartMatchesMarket,
  getCartDisplayMarket,
  removeCartItem,
  setCartItemQuantity,
} from "@/domain/cart/cart";
import type { Cart } from "@/domain/cart/types";
import {
  getActiveCartStorageKey,
} from "@/domain/cart/browser-cart-scope";
import { marketSwitchDestination } from "@/domain/markets/market";
import type { Market } from "@/domain/markets/types";
import { formatMarketMoney } from "@/domain/money";
import styles from "./storefront.module.css";

function updateCart(update: (cart: Cart) => Cart) {
  const repository = createBrowserCartRepository(window.localStorage);
  repository.save(update(repository.load()));
  notifyCartChanged();
}

function removeItemFromCart(itemId: string) {
  const repository = createBrowserCartRepository(window.localStorage);
  const current = repository.load();
  const item = current.items.find((candidate) => candidate.id === itemId);
  repository.save(removeCartItem(current, itemId));
  notifyCartChanged();
  if (item) {
    try {
      emitAnalyticsEvent(buildCartItemEvent("remove_from_cart", item));
    } catch {
      // Analytics must never change a successfully persisted cart action.
    }
  }
}

function labelFor(value: string): string {
  const labels: Record<string, string> = {
    upload: "Upload Photos Now",
    later: "Send Photos After Ordering",
    landscape: "Landscape",
    portrait: "Portrait",
    post: "Post",
    pickup: "Pickup",
  };
  return labels[value] ?? value;
}

export function CartView({ market = "NZ" }: Readonly<{ market?: Market }>) {
  const snapshot = useSyncExternalStore(
    subscribeToCart,
    getCartSnapshot,
    () => EMPTY_CART_JSON,
  );
  const cart = parseStoredCart(snapshot);
  const totals = calculateCartTotals(cart);
  const displayMarket = getCartDisplayMarket(cart);
  const needsConfiguration = !cartMatchesMarket(cart, market);

  if (cart.items.length === 0) {
    return (
      <section className={styles.cartEmpty} aria-labelledby="empty-cart-title">
        <h2 id="empty-cart-title">Your cart is empty</h2>
        <p>Choose a custom product to begin creating your artwork.</p>
        <div className={styles.emptyStateActions}>
          <Link className={styles.primaryButton} href={marketSwitchDestination("/canvas", market)}>Browse Canvas</Link>
          <Link className={styles.secondaryButton} href={marketSwitchDestination("/banners", market)}>Browse Banners</Link>
          <Link className={styles.secondaryButton} href="/design-gallery">Design Gallery</Link>
        </div>
      </section>
    );
  }

  return (
    <div className={styles.cartLayout}>
      <AnalyticsEventTracker
        event={buildCartEvent("view_cart", cart)}
        scopeKey={getActiveCartStorageKey()}
      />
      <section className={styles.cartItems} aria-label="Cart items">
        {needsConfiguration ? <p role="status">Your cart keeps its configured prices, production service and dates. Edit configuration for {market === "AU" ? "Australia" : "New Zealand"} before checking out in this country. Your existing items stay in your cart.</p> : null}
        {cart.items.map((item) => (
          <article className={styles.cartItem} key={item.id}>
            <button
              className={styles.removeItem}
              type="button"
              aria-label={`Remove ${item.productTitle}`}
              onClick={() => removeItemFromCart(item.id)}
            >×</button>
            <div className={styles.cartItemMedia}>
              <CartProductImage src={item.imageSrc} productSlug={item.productSlug} title={item.productTitle} />
            </div>
            <div className={styles.cartItemDetails}>
              <h2>{item.productTitle}</h2>
              <Link aria-label={`Edit configuration for ${item.productTitle}`} href={`${marketSwitchDestination(`/products/${item.productSlug}/configure`, market)}?${new URLSearchParams({ edit: item.id, size: item.sizeKey, ...(item.galleryDesignId ? { design: item.galleryDesignId } : {}) }).toString()}`}>
                Edit configuration
              </Link>
              {item.galleryDesignId && (
                <div className={styles.gallerySnapshotText}>
                  <strong>Selected design inspiration</strong>
                  <Link href={`${marketSwitchDestination(`/products/${item.productSlug}/configure`, market)}?design=${item.galleryDesignId}`}>
                    View selected design
                  </Link>
                </div>
              )}
              <dl>
                <div><dt>Size</dt><dd>{item.sizeLabel}</dd></div>
                {item.orientation && <div><dt>Orientation</dt><dd>{labelFor(item.orientation)}</dd></div>}
                {item.peoplePets > 0 && <div><dt>People / pets</dt><dd>{item.peoplePets}</dd></div>}
                <div><dt>Photo submission</dt><dd>{labelFor(item.photoSubmissionMethod)}</dd></div>
                {item.eventDate ? <div><dt>Event date</dt><dd>{item.eventDate}</dd></div> : null}
                <div><dt>Estimated production completion</dt><dd>{item.neededDate}</dd></div>
                {item.productionWorkingDays ? <div><dt>Production service</dt><dd>{item.productionWorkingDays} working days</dd></div> : null}
                {Boolean(item.urgentFeeInclGstCents) && (
                  <div>
                    <dt>Urgent service</dt>
                    <dd>{formatMarketMoney(item.urgentFeeInclGstCents!, ("currency" in item.price ? item.price.currency : "NZD"))}{("taxJurisdiction" in item.price && item.price.taxJurisdiction === "NONE") ? "" : " incl GST"}</dd>
                  </div>
                )}
                <div><dt>Delivery</dt><dd>{labelFor(item.deliveryPreference)}</dd></div>
              </dl>
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
            <div className={styles.cartItemActions}>
              <label>
                <span>Quantity</span>
                <select
                  aria-label={`Quantity for ${item.productTitle}`}
                  value={item.quantity}
                  onChange={(event) =>
                    updateCart((current) =>
                      setCartItemQuantity(current, item.id, Number(event.target.value)))
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
        <Link className={styles.secondaryButton} href={marketSwitchDestination("/shop", market)}>Continue shopping</Link>
      </section>

      <aside className={styles.cartTotals} aria-label="Cart totals">
        <p className={styles.eyebrow}>Order total</p>
        <h2>Cart summary</h2>
        {displayMarket ? <dl className={styles.priceLines}>
          <div><dt>{displayMarket.taxJurisdiction === "NONE" ? "Subtotal" : "Subtotal incl GST"}</dt><dd>{formatMarketMoney(totals.totalInclGstCents, displayMarket.currency)}</dd></div>
          {displayMarket.taxJurisdiction !== "NONE" ? <div><dt>{displayMarket.taxJurisdiction === "NZ_GST" ? "Includes GST (15%)" : "Includes Australian GST"}</dt><dd>{formatMarketMoney(totals.gstCents, displayMarket.currency)}</dd></div> : null}
          <div className={styles.priceTotal}><dt>{displayMarket.taxJurisdiction === "NONE" ? "Total" : "Total incl GST"}</dt><dd>{formatMarketMoney(totals.totalInclGstCents, displayMarket.currency)}</dd></div>
        </dl> : <p>Your items use different currencies. Edit configuration to use one delivery country.</p>}
        {!needsConfiguration ? <Link className={styles.primaryButton} href="/checkout/start">Continue to checkout</Link> : null}
        <p className={styles.cartAssurance}>Draft approval comes before production.</p>
      </aside>
    </div>
  );
}
