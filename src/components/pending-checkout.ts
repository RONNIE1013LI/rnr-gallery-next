import {
  createBrowserCartRepository,
  normalizeLegacyGraveCoverCart,
  parseStoredCart,
} from "@/domain/cart/browser-cart-repository";
import {
  getActiveCartStorageKey,
  getActivePendingCheckoutStorageKey,
  getPendingCheckoutStorageKey,
} from "@/domain/cart/browser-cart-scope";
import { type Cart, type StorageLike } from "@/domain/cart/types";
import {
  parsePaymentRecoveryIntent,
  type CheckoutStartingPaymentIntent,
  type PlacingOrderIntent,
} from "./payment-recovery-intent";

export const LEGACY_PENDING_CHECKOUT_STORAGE_KEY = "rnr-pending-checkout-v1";
export const PENDING_CHECKOUT_STORAGE_KEY = getPendingCheckoutStorageKey(null);

export type PendingCheckout = Readonly<{
  schemaVersion: 1;
  intent: PlacingOrderIntent | CheckoutStartingPaymentIntent;
  cart: Cart;
}>;

function sameCart(left: Cart, right: Cart) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function pendingCheckoutMatchesCart(
  pending: PendingCheckout | null,
  cart: Cart,
) {
  return Boolean(pending && cart.items.length > 0 && sameCart(pending.cart, cart));
}

export function savePendingCheckout(
  storage: StorageLike,
  intent: PendingCheckout["intent"],
  cart: Cart,
) {
  if (cart.items.length === 0) return;
  const safeCart = parseStoredCart(JSON.stringify(cart));
  if (safeCart.items.length === 0) return;
  const pending: PendingCheckout = { schemaVersion: 1, intent, cart: safeCart };
  storage.setItem(getActivePendingCheckoutStorageKey(), JSON.stringify(pending));
}

export function readPendingCheckout(storage: StorageLike): PendingCheckout | null {
  const storageKey = getActivePendingCheckoutStorageKey();
  const raw = storage.getItem(storageKey);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      !value ||
      value.schemaVersion !== 1 ||
      Object.keys(value).sort().join(",") !== "cart,intent,schemaVersion"
    ) throw new Error("Invalid pending checkout");
    const parsedIntent = parsePaymentRecoveryIntent(JSON.stringify(value.intent));
    const cart = parseStoredCart(JSON.stringify(value.cart));
    const normalizedStoredCart = normalizeLegacyGraveCoverCart(value.cart as Cart);
    if (
      !parsedIntent ||
      !("orderIdempotencyKey" in parsedIntent) ||
      (parsedIntent.phase !== "placing_order" && parsedIntent.phase !== "starting_payment") ||
      cart.items.length === 0 ||
      JSON.stringify(cart) !== JSON.stringify(normalizedStoredCart)
    ) throw new Error("Invalid pending checkout");
    return Object.freeze({
      schemaVersion: 1,
      intent: parsedIntent,
      cart,
    });
  } catch {
    storage.removeItem(storageKey);
    return null;
  }
}

export function clearPendingCheckout(storage: StorageLike, orderNumber?: string) {
  if (orderNumber) {
    const pending = readPendingCheckout(storage);
    if (
      !pending ||
      pending.intent.phase !== "starting_payment" ||
      pending.intent.orderNumber !== orderNumber
    ) return;
  }
  storage.removeItem(getActivePendingCheckoutStorageKey());
}

export function completePendingCheckout(storage: StorageLike, orderNumber: string) {
  const pending = readPendingCheckout(storage);
  if (
    !pending ||
    pending.intent.phase !== "starting_payment" ||
    pending.intent.orderNumber !== orderNumber
  ) return false;
  const repository = createBrowserCartRepository(storage);
  const currentCart = parseStoredCart(storage.getItem(getActiveCartStorageKey()));
  const shouldClearCart = pendingCheckoutMatchesCart(pending, currentCart);
  if (shouldClearCart) repository.clear();
  storage.removeItem(getActivePendingCheckoutStorageKey());
  return shouldClearCart;
}
