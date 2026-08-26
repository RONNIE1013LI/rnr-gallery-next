"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
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
  applyAuthoritativeRepricing,
  removeCartItem,
  setCartItemQuantity,
} from "@/domain/cart/cart";
import type { Cart } from "@/domain/cart/types";
import {
  clearIdentityCheckoutState,
  getActiveCartStorageKey,
  getActiveCustomerId,
} from "@/domain/cart/browser-cart-scope";
import { marketSwitchDestination } from "@/domain/markets/market";
import { requestMarketSwitch } from "@/domain/markets/browser-market-switch";
import type { Market } from "@/domain/markets/types";
import { formatMarketMoney } from "@/domain/money";
import {
  hasStaleUrgentDate,
  MarketSwitchDialog,
  type MarketSwitchDialogState,
} from "./market-switch-dialog";
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
  const needsMarketReconciliation = cart.items.length > 0 && !cartMatchesMarket(cart, market);
  const reconciliationRef = useRef<string | null>(null);
  const [reconciliationError, setReconciliationError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [reconciliationPending, setReconciliationPending] = useState(false);
  const [marketDialog, setMarketDialog] = useState<MarketSwitchDialogState | null>(null);

  const reconcileMarket = useCallback(async (candidateCart: Cart) => {
    const initiatingCustomerId = getActiveCustomerId();
    setReconciliationPending(true);
    setReconciliationError(null);
    try {
      const result = await requestMarketSwitch({
        market,
        candidateCart,
        persistPreference: false,
      });
      if (getActiveCustomerId() !== initiatingCustomerId) return;
      if (!result.ok) {
        if (
          "code" in result.payload &&
          result.payload.code === "urgent_confirmation_required" &&
          result.payload.issues?.length
        ) {
          setMarketDialog({
            targetMarket: market,
            cart: candidateCart,
            issues: result.payload.issues,
            message: result.payload.error,
          });
          return;
        }
        setReconciliationError(
          "error" in result.payload
            ? result.payload.error
            : "The cart could not be repriced for this market.",
        );
        return;
      }
      if (!("cart" in result.payload) || !result.payload.cart) {
        setReconciliationError("The cart could not be repriced for this market.");
        return;
      }
      const repository = createBrowserCartRepository(window.localStorage);
      repository.save(applyAuthoritativeRepricing(candidateCart, result.payload.cart));
      clearIdentityCheckoutState(
        window.localStorage,
        window.sessionStorage,
        initiatingCustomerId,
      );
      setMarketDialog(null);
      notifyCartChanged();
    } catch {
      if (getActiveCustomerId() === initiatingCustomerId) {
        setReconciliationError("The cart could not be repriced for this market.");
      }
    } finally {
      setReconciliationPending(false);
    }
  }, [market]);

  useEffect(() => {
    if (!needsMarketReconciliation) {
      reconciliationRef.current = null;
      return;
    }
    const reconciliationKey = `${market}:${snapshot}:${retryNonce}`;
    if (reconciliationRef.current === reconciliationKey) return;
    reconciliationRef.current = reconciliationKey;
    const candidateCart = createBrowserCartRepository(window.localStorage).load();
    void reconcileMarket(candidateCart);
  }, [market, needsMarketReconciliation, reconcileMarket, retryNonce, snapshot]);

  function changeMarketDialogDate(clientItemId: string, neededDate: string) {
    setMarketDialog((current) => current ? {
      ...current,
      cart: {
        version: 1,
        items: current.cart.items.map((item) => item.id === clientItemId
          ? { ...item, neededDate, urgentServiceConfirmed: false }
          : item),
      },
    } : null);
  }

  function confirmMarketDialogUrgent() {
    if (!marketDialog || reconciliationPending || hasStaleUrgentDate(marketDialog)) return;
    const urgentIds = new Set(marketDialog.issues.map((issue) => issue.clientItemId));
    void reconcileMarket({
      version: 1,
      items: marketDialog.cart.items.map((item) => urgentIds.has(item.id)
        ? { ...item, urgentServiceConfirmed: true }
        : item),
    });
  }

  if (cart.items.length === 0) {
    return (
      <section className={styles.cartEmpty}>
        <h2>Your cart is empty</h2>
        <p>Choose a custom product to begin creating your artwork.</p>
        <div className={styles.emptyStateActions}>
          <Link className={styles.primaryButton} href={marketSwitchDestination("/canvas", market)}>Browse Canvas</Link>
          <Link className={styles.secondaryButton} href={marketSwitchDestination("/banners", market)}>Browse Banners</Link>
          <Link className={styles.secondaryButton} href="/design-gallery">Design Gallery</Link>
        </div>
      </section>
    );
  }

  if (needsMarketReconciliation) {
    return (
      <>
        <section className={styles.cartEmpty} aria-live="polite">
          <h2>Updating your cart</h2>
          {reconciliationError ? (
            <>
              <p role="alert">{reconciliationError}</p>
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={() => setRetryNonce((current) => current + 1)}
              >Try again</button>
            </>
          ) : (
            <p>Updating cart prices for {market === "AU" ? "Australia" : "New Zealand"}…</p>
          )}
        </section>
        {marketDialog ? <MarketSwitchDialog state={marketDialog} pending={reconciliationPending} confirmDisabled={hasStaleUrgentDate(marketDialog)} onDateChange={changeMarketDialogDate} onConfirmUrgent={confirmMarketDialogUrgent} onTryDates={() => void reconcileMarket(marketDialog.cart)} onCancel={() => { if (!reconciliationPending) { setMarketDialog(null); setReconciliationError("Review urgent service before checking out in this market."); } }} /> : null}
      </>
    );
  }

  return (
    <div className={styles.cartLayout}>
      <AnalyticsEventTracker
        event={buildCartEvent("view_cart", cart)}
        scopeKey={getActiveCartStorageKey()}
      />
      <section className={styles.cartItems} aria-label="Cart items">
        {cart.items.map((item) => (
          <article className={styles.cartItem} key={item.id}>
            <button
              className={styles.removeItem}
              type="button"
              aria-label={`Remove ${item.productTitle}`}
              onClick={() => removeItemFromCart(item.id)}
            >×</button>
            <div className={styles.cartItemMedia}>
              <Image src={item.imageSrc} alt="" width={96} height={96} />
            </div>
            <div className={styles.cartItemDetails}>
              <h2>{item.productTitle}</h2>
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
                <div><dt>Production completion date</dt><dd>{item.neededDate}</dd></div>
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
          <div><dt>{displayMarket.taxJurisdiction === "NZ_GST" ? "Includes GST (15%)" : displayMarket.taxJurisdiction === "AU_GST" ? "Includes Australian GST" : "GST not charged"}</dt><dd>{formatMarketMoney(totals.gstCents, displayMarket.currency)}</dd></div>
          <div className={styles.priceTotal}><dt>{displayMarket.taxJurisdiction === "NONE" ? "Total" : "Total incl GST"}</dt><dd>{formatMarketMoney(totals.totalInclGstCents, displayMarket.currency)}</dd></div>
        </dl> : <p>Prices will be recalculated for the selected delivery country.</p>}
        <Link className={styles.primaryButton} href="/checkout/start">Continue to checkout</Link>
        <p className={styles.cartAssurance}>Draft approval comes before production.</p>
      </aside>
    </div>
  );
}
