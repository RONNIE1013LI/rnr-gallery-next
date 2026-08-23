"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AddressInput } from "@/domain/address/types";
import { ADDRESS_FIELD_LIMITS, addressInputSchema } from "@/domain/address/schema";
import { readAttribution } from "@/domain/analytics/attribution";
import { emitAnalyticsEvent } from "@/domain/analytics/client";
import { buildCartEvent, buildCheckoutEvent, type CheckoutAnalyticsDetails } from "@/domain/analytics/events";
import { createBrowserCartRepository, parseStoredCart } from "@/domain/cart/browser-cart-repository";
import { EMPTY_CART_JSON, getCartSnapshot, notifyCartChanged, subscribeToCart } from "@/domain/cart/browser-cart-events";
import {
  getActiveCartStorageKey,
  getActiveCheckoutDraftStorageKey,
  getActiveCheckoutIntentCartBackupKey,
  getActiveCustomerId,
  getActivePaymentIntentStorageKey,
} from "@/domain/cart/browser-cart-scope";
import { type Cart } from "@/domain/cart/types";
import { cartToCheckoutInput } from "@/domain/cart/checkout-input";
import type { RepricedCheckoutCart } from "@/domain/checkout/types";
import { formatMarketMoney } from "@/domain/money";
import type { PublicShippingDTO } from "@/server/checkout/public-dto";
import type { PaymentMethodKey } from "@/server/db/schema/payments";
import type { PaymentActionDTO } from "@/server/payments/public-dto";
import { createClientId } from "@/lib/client-id";
import { AddressForm, type AddressFieldErrors } from "./address-form";
import { AnalyticsEventTracker } from "./analytics-event-tracker";
import { CheckoutOrderSummary } from "./checkout-order-summary";
import { followPaymentAction, PaymentStartError, startOrderPayment } from "./order-payment-panel";
import { PaymentMethods, type PaymentMethodOption } from "./payment-methods";
import { StripePaymentForm } from "./stripe-payment-form";
import {
  readPaymentRecoveryIntent,
  type CheckoutStartingPaymentIntent,
  type PlacingOrderIntent,
} from "./payment-recovery-intent";
import {
  clearPendingCheckout,
  completePendingCheckout,
  pendingCheckoutMatchesCart,
  readPendingCheckout,
  savePendingCheckout,
} from "./pending-checkout";
import styles from "./storefront.module.css";

export type CheckoutSavedAddress = AddressInput & { id: string };
const emptyAddress: AddressInput = { country: "NZ", fullName: "", building: "", street: "", suburb: "", region: "", postcode: "", phone: "", email: "" };
const LEGACY_IDEMPOTENCY_STORAGE_KEY = "rnr-checkout-order-idempotency-v1";
const LEGACY_PLACEMENT_STORAGE_KEY = "rnr-checkout-pending-placement-v1";
type CheckoutPaymentIntent = PlacingOrderIntent | CheckoutStartingPaymentIntent;
type CheckoutDraft = Readonly<{
  schemaVersion: 1;
  cartSnapshot: string;
  billing: AddressInput;
  delivery: AddressInput;
  different: boolean;
}>;
type CheckoutIntentCartBackup = Readonly<{
  schemaVersion: 1;
  intentKey: string;
  cart: Cart;
}>;

function checkoutIntentKey(intent: CheckoutPaymentIntent) {
  return intent.orderIdempotencyKey;
}

function readCheckoutIntentCart(storage: Pick<Storage, "getItem">, intent: CheckoutPaymentIntent | null) {
  if (!intent) return null;
  try {
    const value = JSON.parse(storage.getItem(getActiveCheckoutIntentCartBackupKey()) ?? "null") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const entry = value as Partial<CheckoutIntentCartBackup>;
    if (entry.schemaVersion !== 1 || entry.intentKey !== checkoutIntentKey(intent)) return null;
    if (!entry.cart || typeof entry.cart !== "object" || Array.isArray(entry.cart)) return null;
    const cart = parseStoredCart(JSON.stringify(entry.cart));
    return cart;
  } catch {
    return null;
  }
}

function clearCheckoutIntentCartBackup(storage: Pick<Storage, "removeItem">) {
  storage.removeItem(getActiveCheckoutIntentCartBackupKey());
}

function setCheckoutIntentCartBackup(storage: Pick<Storage, "setItem">, intent: CheckoutPaymentIntent, cart: Cart) {
  if (cart.items.length === 0) return;
  const entry: CheckoutIntentCartBackup = {
    schemaVersion: 1,
    intentKey: checkoutIntentKey(intent),
    cart,
  };
  storage.setItem(getActiveCheckoutIntentCartBackupKey(), JSON.stringify(entry));
}

const recoveryRequests = new Map<string, Promise<unknown>>();
function readPaymentIntent() {
  if (typeof window === "undefined") return null;
  const intent = readPaymentRecoveryIntent(window.sessionStorage);
  window.sessionStorage.removeItem(LEGACY_IDEMPOTENCY_STORAGE_KEY);
  window.sessionStorage.removeItem(LEGACY_PLACEMENT_STORAGE_KEY);
  return intent && "orderIdempotencyKey" in intent ? intent : null;
}

function placementRequest(intent: CheckoutPaymentIntent) {
  const attribution = typeof window === "undefined"
    ? null
    : readAttribution(window.sessionStorage, getActiveCustomerId());
  return {
    idempotencyKey: intent.orderIdempotencyKey,
    checkoutVersion: intent.checkoutVersion,
    cartDigest: intent.cartDigest,
    shipping: intent.shipping,
    ...(attribution ? { attribution } : {}),
  };
}

function addressInput(address: AddressInput): AddressInput {
  const { country, fullName, building, street, suburb, region, postcode, phone, email } = address;
  return { country, fullName, building, street, suburb, region, postcode, phone, email };
}

function isDraftAddress(value: unknown): value is AddressInput {
  if (!value || typeof value !== "object") return false;
  const address = value as Record<string, unknown>;
  if (address.country !== "NZ" && address.country !== "AU") return false;
  const limits = { ...ADDRESS_FIELD_LIMITS, postcode: 4 } as const;
  return (Object.keys(limits) as Array<keyof typeof limits>)
    .every((field) => typeof address[field] === "string" && (address[field] as string).length <= limits[field]);
}

function readCheckoutDraft(storage: Storage, cartSnapshot: string): CheckoutDraft | null {
  try {
    const value = JSON.parse(storage.getItem(getActiveCheckoutDraftStorageKey()) ?? "null") as Partial<CheckoutDraft> | null;
    if (!value || value.schemaVersion !== 1 || value.cartSnapshot !== cartSnapshot) return null;
    if (!isDraftAddress(value.billing) || !isDraftAddress(value.delivery)) return null;
    if (typeof value.different !== "boolean") return null;
    return value as CheckoutDraft;
  } catch {
    return null;
  }
}

export const canonicalCheckoutCart = cartToCheckoutInput;

class CheckoutApiError extends Error { constructor(message: string, readonly code: string | undefined, readonly status: number, readonly fields?: unknown) { super(message); } }
async function postJson(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json();
  if (!response.ok) throw new CheckoutApiError(payload.error?.message ?? "Request failed", payload.error?.code, response.status, payload.error?.fields);
  return payload;
}

function recoverRequest<T>(key: string, request: () => Promise<T>) {
  const scopedKey = `${getActiveCustomerId() ?? "guest"}:${key}`;
  const existing = recoveryRequests.get(scopedKey);
  if (existing) return existing as Promise<T>;
  const pending = request().finally(() => recoveryRequests.delete(scopedKey));
  recoveryRequests.set(scopedKey, pending);
  return pending;
}

function scrollPageToTopImmediately() {
  const root = document.documentElement;
  const previousScrollBehavior = root.style.scrollBehavior;
  root.style.scrollBehavior = "auto";
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  root.style.scrollBehavior = previousScrollBehavior;
}

function addressErrors(result: ReturnType<typeof addressInputSchema.safeParse>): AddressFieldErrors {
  if (result.success) return {};
  const errors: AddressFieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as keyof AddressInput;
    errors[field] = [...(errors[field] ?? []), issue.message];
  }
  return errors;
}

function cannotResumePayment(error: unknown) {
  return error instanceof PaymentStartError && [401, 403, 404].includes(error.status);
}

function reviewErrorMessage(error: unknown) {
  if (error instanceof CheckoutApiError) return error.message;
  return "We couldn’t review delivery right now. Check your connection and try again.";
}

function trackCheckoutEvent(
  name: "add_shipping_info" | "add_payment_info",
  cart: RepricedCheckoutCart,
  details: CheckoutAnalyticsDetails,
) {
  try {
    emitAnalyticsEvent(buildCheckoutEvent(name, cart, details));
  } catch {
    // Analytics must never interrupt checkout or payment submission.
  }
}

export function CheckoutView({ savedAddresses = [] }: { savedAddresses?: CheckoutSavedAddress[] }) {
  const { push } = useRouter();
  const snapshot = useSyncExternalStore(subscribeToCart, getCartSnapshot, () => EMPTY_CART_JSON);
  const cart = parseStoredCart(snapshot);
  const first = savedAddresses[0];
  const [billing, setBilling] = useState<AddressInput>(first ? addressInput(first) : emptyAddress);
  const [different, setDifferent] = useState(false);
  const [delivery, setDelivery] = useState<AddressInput>(first ? addressInput(first) : emptyAddress);
  const method = cart.items[0]?.deliveryPreference ?? "post";
  const [reviewedCart, setReviewedCart] = useState<RepricedCheckoutCart | null>(null);
  const [reviewedVersion, setReviewedVersion] = useState<number | null>(null);
  const [shipping, setShipping] = useState<PublicShippingDTO["option"] | null>(null);
  const [shippingOptions, setShippingOptions] = useState<PublicShippingDTO["options"]>([]);
  const [reviewKey, setReviewKey] = useState("");
  const [paymentMethods, setPaymentMethods] = useState<readonly PaymentMethodOption[]>([]);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethodKey | null>(null);
  const [paymentReviewKey, setPaymentReviewKey] = useState("");
  const [message, setMessage] = useState("");
  const [paymentIntent, setPaymentIntent] = useState<CheckoutPaymentIntent | null>(null);
  const [paymentAction, setPaymentAction] = useState<PaymentActionDTO | null>(null);
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const [draftChecked, setDraftChecked] = useState(false);
  const [pending, setPending] = useState<"review" | "shipping" | "order" | null>(null);
  const [billingErrors, setBillingErrors] = useState<AddressFieldErrors>({});
  const [deliveryErrors, setDeliveryErrors] = useState<AddressFieldErrors>({});
  const [billingSavedId, setBillingSavedId] = useState(first?.id ?? "");
  const [deliverySavedId, setDeliverySavedId] = useState(first?.id ?? "");
  const [isReturningToOrder, setIsReturningToOrder] = useState(false);
  const reviewing = useRef(false);
  const placing = useRef(false);
  const currentKey = JSON.stringify({ snapshot, billing, delivery: different ? delivery : billing, different, method });
  const isReviewed = Boolean(reviewKey === currentKey && reviewedCart && reviewedVersion !== null && shipping);
  const hasPaymentAuthority = Boolean(isReviewed && paymentReviewKey === currentKey);
  const checkoutLocked = Boolean(!recoveryChecked || !draftChecked || pending || paymentIntent);
  const hasPersistedPaymentIntent = typeof window !== "undefined"
    ? window.sessionStorage.getItem(getActivePaymentIntentStorageKey()) !== null
    : false;

  const rememberPlacedCart = useCallback((intent: CheckoutStartingPaymentIntent, orderedCart: Cart) => {
    setCheckoutIntentCartBackup(window.sessionStorage, intent, orderedCart);
    savePendingCheckout(window.localStorage, intent, orderedCart);
    window.sessionStorage.removeItem(getActiveCheckoutDraftStorageKey());
  }, []);

  const restoreCart = useCallback((cartToRestore: Cart) => {
    if (cartToRestore.items.length === 0) return;
    createBrowserCartRepository(window.localStorage).save(cartToRestore);
    clearCheckoutIntentCartBackup(window.sessionStorage);
    notifyCartChanged();
  }, []);

  const restoreCartIfEmpty = useCallback((cartToRestore: Cart) => {
    const currentCart = parseStoredCart(window.localStorage.getItem(getActiveCartStorageKey()));
    if (currentCart.items.length > 0) return;
    restoreCart(cartToRestore);
  }, [restoreCart]);

  const finishPaymentStart = useCallback(async (orderNumber: string, payload: Awaited<ReturnType<typeof startOrderPayment>>) => {
    const orderHref = `/orders/${orderNumber}`;
    if (payload.action?.kind === "elements") {
      scrollPageToTopImmediately();
      setPaymentAction(payload.action);
      placing.current = false;
      setPending(null);
      return;
    }
    if (payload.action) {
      await followPaymentAction(payload.action, orderHref, {
        assign: (url) => window.location.assign(url),
        navigate: push,
      });
      return;
    }
    if (["paid", "failed", "cancelled"].includes(payload.payment.status)) {
      window.sessionStorage.removeItem(getActivePaymentIntentStorageKey());
      clearCheckoutIntentCartBackup(window.sessionStorage);
      if (payload.payment.status === "paid") {
        if (completePendingCheckout(window.localStorage, orderNumber)) notifyCartChanged();
      }
      setPaymentIntent(null);
    }
    push(`${orderHref}#payment`);
  }, [push]);

  const invalidatePlacement = useCallback(() => {
    window.sessionStorage.removeItem(getActivePaymentIntentStorageKey());
    clearCheckoutIntentCartBackup(window.sessionStorage);
    clearPendingCheckout(window.localStorage);
    setPaymentIntent(null);
    setPaymentAction(null);
    setReviewedCart(null);
    setReviewedVersion(null);
    setShipping(null);
    setShippingOptions([]);
    setReviewKey("");
    setPaymentMethods([]);
    setSelectedPaymentMethod(null);
    setPaymentReviewKey("");
    setMessage("Checkout changed. Review delivery and totals again.");
  }, [setSelectedPaymentMethod]);

  const handlePlacementFailure = useCallback((error: unknown, intent: CheckoutPaymentIntent | null) => {
    if (intent && error instanceof PaymentStartError) {
      const backup = readCheckoutIntentCart(window.sessionStorage, intent);
      if (backup) restoreCartIfEmpty(backup);
    }
    placing.current = false;
    if (error instanceof CheckoutApiError && error.code === "CHECKOUT_CHANGED") invalidatePlacement();
    else setMessage(error instanceof Error ? error.message : "Order could not be created.");
    setPending(null);
  }, [invalidatePlacement, restoreCartIfEmpty]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      let intent = readPaymentIntent();
      const currentCart = parseStoredCart(window.localStorage.getItem(getActiveCartStorageKey()));
      const durablePending = readPendingCheckout(window.localStorage);
      if (!intent && pendingCheckoutMatchesCart(durablePending, currentCart)) {
        intent = durablePending!.intent;
        window.sessionStorage.setItem(getActivePaymentIntentStorageKey(), JSON.stringify(intent));
      }
      if (!intent) {
        if (durablePending) clearPendingCheckout(window.localStorage);
        setRecoveryChecked(true);
        return;
      }
      const intentCartBackup = readCheckoutIntentCart(window.sessionStorage, intent);
      if (intent.phase === "starting_payment" && currentCart.items.length > 0) {
        if (
          durablePending?.intent.phase === "starting_payment" &&
          durablePending.intent.orderNumber === intent.orderNumber &&
          pendingCheckoutMatchesCart(durablePending, currentCart)
        ) {
          setPaymentIntent(intent);
          setPending("order");
          setRecoveryChecked(true);
          push(`/orders/${intent.orderNumber}#payment`);
          return;
        }
        window.sessionStorage.removeItem(getActivePaymentIntentStorageKey());
        clearCheckoutIntentCartBackup(window.sessionStorage);
        clearPendingCheckout(window.localStorage);
        setMessage("Your cart is ready to checkout.");
        setRecoveryChecked(true);
        return;
      }
      setPaymentIntent(intent);
      setPending("order");
      setRecoveryChecked(true);
      const cartForRecovery: Cart | null =
        durablePending && durablePending.intent.orderIdempotencyKey === intent.orderIdempotencyKey
          ? durablePending.cart
          : intentCartBackup;
      let recoveredOrderNumber = intent.phase === "starting_payment" ? intent.orderNumber : null;
      try {
        let starting: CheckoutStartingPaymentIntent;
        if (intent.phase === "placing_order") {
          const payload = await recoverRequest(`order:${JSON.stringify(intent)}`, () => postJson("/api/checkout/order", placementRequest(intent))) as { order: { orderNumber: string } };
          starting = { ...intent, phase: "starting_payment", orderNumber: payload.order.orderNumber };
          recoveredOrderNumber = starting.orderNumber;
          if (cartForRecovery) rememberPlacedCart(starting, cartForRecovery);
          window.sessionStorage.setItem(getActivePaymentIntentStorageKey(), JSON.stringify(starting));
          if (active) setPaymentIntent(starting);
        } else starting = intent;
        const payment = await recoverRequest(`payment:${JSON.stringify(starting)}`, () => startOrderPayment(starting.orderNumber, starting.method, starting.paymentIdempotencyKey));
        if (active) await finishPaymentStart(starting.orderNumber, payment);
      } catch (error) {
        if (active) {
          if (cannotResumePayment(error)) {
            const backup = intent.phase === "placing_order" ? readCheckoutIntentCart(window.sessionStorage, intent) : intentCartBackup;
            if (backup) restoreCartIfEmpty(backup);
            else if (cartForRecovery) restoreCartIfEmpty(cartForRecovery);
            window.sessionStorage.removeItem(getActivePaymentIntentStorageKey());
            if (recoveredOrderNumber) clearPendingCheckout(window.localStorage, recoveredOrderNumber);
            else clearPendingCheckout(window.localStorage);
            setPaymentIntent(null);
            setPending(null);
            setMessage("Your previous payment session is no longer available. Your cart is ready to checkout.");
            return;
          }
          if (intent.phase === "starting_payment") {
            const backup = intentCartBackup;
            if (backup) restoreCartIfEmpty(backup);
          }
          handlePlacementFailure(error, intent);
          const current = readPaymentIntent();
          if (current?.phase === "starting_payment") push(`/orders/${current.orderNumber}#payment`);
        }
      }
    });
    return () => { active = false; };
  }, [finishPaymentStart, handlePlacementFailure, push, rememberPlacedCart, restoreCartIfEmpty]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active || draftChecked) return;
      if (cart.items.length === 0) {
        window.sessionStorage.removeItem(getActiveCheckoutDraftStorageKey());
        setDraftChecked(true);
        return;
      }
      const draft = readCheckoutDraft(window.sessionStorage, snapshot);
      if (draft) {
        setBilling(draft.billing);
        setDelivery(draft.delivery);
        setDifferent(draft.different);
        setBillingSavedId("");
        setDeliverySavedId("");
        setMessage("Your checkout details were restored. Review delivery and totals again.");
      } else {
        window.sessionStorage.removeItem(getActiveCheckoutDraftStorageKey());
      }
      setDraftChecked(true);
    });
    return () => { active = false; };
  }, [cart.items.length, draftChecked, snapshot]);

  useEffect(() => {
    if (!draftChecked || cart.items.length === 0 || paymentIntent) return;
    const draft: CheckoutDraft = { schemaVersion: 1, cartSnapshot: snapshot, billing, delivery, different };
    window.sessionStorage.setItem(getActiveCheckoutDraftStorageKey(), JSON.stringify(draft));
  }, [billing, cart.items.length, delivery, different, draftChecked, paymentIntent, snapshot]);

  if (paymentIntent?.phase === "starting_payment" && paymentAction?.kind === "elements") {
    return <section className={styles.orderPaymentPanel} id="payment">
      <h2>Secure card payment</h2>
      <StripePaymentForm
        clientSecret={paymentAction.clientSecret}
        confirmationUrl={`/api/orders/${encodeURIComponent(paymentIntent.orderNumber)}/payment`}
        currency={reviewedCart?.currency ?? "NZD"}
        publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""}
        returnUrl={paymentAction.returnUrl}
        totalInclGstCents={reviewedCart
          ? reviewedCart.totalInclGstCents + (shipping?.amountInclGstCents ?? 0)
          : undefined}
        onPaymentSubmitted={() => {
          if (reviewedCart) {
            trackCheckoutEvent("add_payment_info", reviewedCart, { payment_type: "card" });
          }
        }}
        onPaymentUpdated={(status) => {
          setIsReturningToOrder(true);
          if (status === "paid") {
            if (completePendingCheckout(window.localStorage, paymentIntent.orderNumber)) notifyCartChanged();
          }
          if (status !== "processing") {
            window.sessionStorage.removeItem(getActivePaymentIntentStorageKey());
            clearCheckoutIntentCartBackup(window.sessionStorage);
          }
          push(`/orders/${paymentIntent.orderNumber}`, { scroll: true });
        }}
      />
    </section>;
  }

  if (cart.items.length === 0) {
    if (isReturningToOrder) {
      return <section className={styles.cartEmpty}>
        <h2>Preparing your order confirmation…</h2>
        <p>We received your payment. Redirecting to your order details.</p>
      </section>;
    }
    if (paymentIntent) {
      if (hasPersistedPaymentIntent && !recoveryChecked) {
        return <section className={styles.cartEmpty}>
          <h2>Opening secure payment…</h2>
          <p>Please wait while we prepare your payment.</p>
        </section>;
      }
      return <section className={styles.cartEmpty}>
        <h2>Opening secure payment…</h2>
        <p>Please wait while we prepare your payment.</p>
      </section>;
    }
    return <section className={styles.cartEmpty}>
      <h2>Your cart is empty</h2>
      <p>Add a custom product before starting checkout.</p>
      <div className={styles.emptyStateActions}>
        <Link className={styles.primaryButton} href="/canvas">Browse Canvas</Link>
        <Link className={styles.secondaryButton} href="/banners">Browse Banners</Link>
        <Link className={styles.secondaryButton} href="/design-gallery">Design Gallery</Link>
      </div>
    </section>;
  }

  async function review() {
    if (reviewing.current || checkoutLocked) return;
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setMessage("");
    const billingResult = addressInputSchema.safeParse(billing);
    const deliveryResult = addressInputSchema.safeParse(delivery);
    const nextBillingErrors = addressErrors(billingResult);
    const nextDeliveryErrors = different ? addressErrors(deliveryResult) : {};
    setBillingErrors(nextBillingErrors); setDeliveryErrors(nextDeliveryErrors);
    if (!billingResult.success || (different && !deliveryResult.success)) {
      setMessage("Correct the highlighted address fields, then review again.");
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    const reviewDestination = different && deliveryResult.success
      ? deliveryResult.data
      : billingResult.data;
    const deliveryMethod = reviewDestination.country === "AU" ? "post" : method;
    reviewing.current = true;
    setPending("review");
    try {
      const session = await postJson("/api/checkout/session", { cart: canonicalCheckoutCart(cart), billingAddress: billing, useDifferentDeliveryAddress: different, ...(different ? { deliveryAddress: delivery } : {}), deliveryMethod });
      const quote = await postJson("/api/checkout/shipping", {});
      const payment = await postJson("/api/checkout/payment-methods", { checkoutVersion: session.checkout.version, cartDigest: session.checkout.cart.cartDigest }) as { methods: readonly PaymentMethodOption[] };
      setReviewedCart(session.checkout.cart); setReviewedVersion(session.checkout.version); setShipping(quote.shipping.option); setShippingOptions(quote.shipping.options ?? [quote.shipping.option]); setReviewKey(currentKey);
      setPaymentMethods(payment.methods);
      setSelectedPaymentMethod(payment.methods.find((option) => option.method === "card")?.method ?? payment.methods[0]?.method ?? null);
      setPaymentReviewKey(currentKey);
      setMessage("Delivery and totals reviewed.");
      trackCheckoutEvent("add_shipping_info", session.checkout.cart, {
        shipping_tier: quote.shipping.option.serviceName,
      });
    } catch (error) { const fields = error instanceof CheckoutApiError ? error.fields as { billingAddress?: AddressFieldErrors; deliveryAddress?: AddressFieldErrors } | undefined : undefined; if (fields?.billingAddress) setBillingErrors(fields.billingAddress); if (fields?.deliveryAddress) setDeliveryErrors(fields.deliveryAddress); setReviewedCart(null); setReviewedVersion(null); setShipping(null); setShippingOptions([]); setReviewKey(""); setPaymentMethods([]); setSelectedPaymentMethod(null); setPaymentReviewKey(""); setMessage(reviewErrorMessage(error)); requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); }
    finally { reviewing.current = false; setPending(null); }
  }

  async function selectShippingService(serviceCode: string) {
    if (
      pending ||
      paymentIntent ||
      !isReviewed ||
      !reviewedCart ||
      reviewedVersion === null ||
      shipping?.serviceCode === serviceCode
    ) return;
    setPending("shipping");
    setPaymentReviewKey("");
    setMessage("");
    try {
      const quote = await postJson("/api/checkout/shipping", { serviceCode }) as {
        shipping: PublicShippingDTO;
      };
      const payment = await postJson("/api/checkout/payment-methods", {
        checkoutVersion: reviewedVersion,
        cartDigest: reviewedCart.cartDigest,
      }) as { methods: readonly PaymentMethodOption[] };
      setShipping(quote.shipping.option);
      setShippingOptions(quote.shipping.options);
      setPaymentMethods(payment.methods);
      setSelectedPaymentMethod((current) =>
        payment.methods.some((option) => option.method === current)
          ? current
          : payment.methods.find((option) => option.method === "card")?.method
            ?? payment.methods[0]?.method
            ?? null,
      );
      setPaymentReviewKey(currentKey);
      setMessage(`${quote.shipping.option.serviceName} selected.`);
      trackCheckoutEvent("add_shipping_info", reviewedCart, {
        shipping_tier: quote.shipping.option.serviceName,
      });
    } catch (error) {
      setPaymentMethods([]);
      setSelectedPaymentMethod(null);
      setPaymentReviewKey("");
      setMessage(reviewErrorMessage(error));
    } finally {
      setPending(null);
    }
  }

  async function placeOrder() {
    if ((!paymentIntent && (!isReviewed || !selectedPaymentMethod || !hasPaymentAuthority)) || pending || placing.current) return;
    placing.current = true;
    setPending("order"); setMessage("");
    let starting: CheckoutStartingPaymentIntent | PlacingOrderIntent | null = null;
    const intent = paymentIntent ?? {
      schemaVersion: 1,
      phase: "placing_order",
      orderIdempotencyKey: createClientId(),
      paymentIdempotencyKey: createClientId(),
      method: selectedPaymentMethod!,
      checkoutVersion: reviewedVersion!,
      cartDigest: reviewedCart!.cartDigest,
      shipping: { method: shipping!.method, serviceCode: shipping!.serviceCode, amountExGstCents: shipping!.amountExGstCents, gstCents: shipping!.gstCents, amountInclGstCents: shipping!.amountInclGstCents, isTest: shipping!.isTest },
    } satisfies PlacingOrderIntent;
    const existingPending = readPendingCheckout(window.localStorage);
    const orderedCart = existingPending?.intent.orderIdempotencyKey === intent.orderIdempotencyKey
      ? existingPending.cart
      : cart;
    if (!paymentIntent) {
      window.sessionStorage.setItem(getActivePaymentIntentStorageKey(), JSON.stringify(intent));
      savePendingCheckout(window.localStorage, intent, orderedCart);
      setCheckoutIntentCartBackup(window.sessionStorage, intent, orderedCart);
      setPaymentIntent(intent);
    } else if (intent.phase === "placing_order") {
      savePendingCheckout(window.localStorage, intent, orderedCart);
      setCheckoutIntentCartBackup(window.sessionStorage, intent, orderedCart);
    }
    try {
      starting = intent;
      if (intent.phase === "placing_order") {
        const payload = await postJson("/api/checkout/order", placementRequest(intent));
        starting = { ...intent, phase: "starting_payment", orderNumber: payload.order.orderNumber };
        rememberPlacedCart(starting, orderedCart);
        window.sessionStorage.setItem(getActivePaymentIntentStorageKey(), JSON.stringify(starting));
        setPaymentIntent(starting);
      } else starting = intent;
      if (intent.phase !== "placing_order") rememberPlacedCart(starting, orderedCart);
      const payment = await startOrderPayment(starting.orderNumber, starting.method, starting.paymentIdempotencyKey);
      if (starting.method !== "card" && payment.action && reviewedCart) {
        trackCheckoutEvent("add_payment_info", reviewedCart, {
          payment_type: starting.method,
        });
      }
      await finishPaymentStart(starting.orderNumber, payment);
    } catch (error) {
      handlePlacementFailure(error, starting);
      const current = readPaymentIntent();
      if (current?.phase === "starting_payment") push(`/orders/${current.orderNumber}#payment`);
    }
  }

  return <>
    <AnalyticsEventTracker
      event={buildCartEvent("begin_checkout", cart)}
      scopeKey={getActiveCartStorageKey()}
    />
    <div className={styles.checkoutLayout}>
    <form aria-label="Checkout details" className={styles.checkoutForm} noValidate onSubmit={(event) => { event.preventDefault(); void review(); }}>
      {savedAddresses.length ? <label className={styles.savedAddressSelect}>Saved billing address<select disabled={checkoutLocked} value={billingSavedId} onChange={(event) => { setBillingSavedId(event.target.value); const selected = savedAddresses.find((address) => address.id === event.target.value); if (selected) setBilling(addressInput(selected)); }}><option value="">Enter manually</option>{savedAddresses.map((address) => <option key={address.id} value={address.id}>{address.fullName} · {address.street}</option>)}</select></label> : null}
      <fieldset><legend>Billing address</legend><AddressForm value={billing} onChange={setBilling} errors={billingErrors} disabled={checkoutLocked} /></fieldset>
      <label className={styles.checkoutToggle}><input disabled={checkoutLocked} type="checkbox" checked={different} onChange={(event) => setDifferent(event.target.checked)} /> Deliver to a different address</label>
      {different ? <fieldset><legend>Delivery address</legend>{savedAddresses.length ? <label className={styles.savedAddressSelect}>Saved delivery address<select disabled={checkoutLocked} value={deliverySavedId} onChange={(event) => { setDeliverySavedId(event.target.value); const selected = savedAddresses.find((address) => address.id === event.target.value); if (selected) setDelivery(addressInput(selected)); }}><option value="">Enter manually</option>{savedAddresses.map((address) => <option key={address.id} value={address.id}>{address.fullName} · {address.street}</option>)}</select></label> : null}<AddressForm value={delivery} onChange={setDelivery} errors={deliveryErrors} disabled={checkoutLocked} /></fieldset> : null}
      <button className={`${styles.secondaryButton} ${styles.checkoutReviewButton}`} type="submit" disabled={checkoutLocked}>{!recoveryChecked ? "Checking order status…" : pending === "review" ? "Reviewing…" : "Review delivery & totals"}</button>
      <p aria-live="polite" className={styles.checkoutMessage}>{message}</p>
    </form>
    <aside className={styles.checkoutSummary}><p className={styles.eyebrow}>Your order</p><h2>Order summary</h2>{reviewedCart && !isReviewed ? <p className={styles.checkoutMessage}>Changes need review.</p> : null}{isReviewed && shippingOptions.length > 1 ? <fieldset className={styles.shippingMethodSelector}><legend>Shipping method</legend><div>{shippingOptions.map((option) => <label key={option.serviceCode}><input type="radio" name="shippingService" value={option.serviceCode} checked={shipping?.serviceCode === option.serviceCode} disabled={checkoutLocked} onChange={() => void selectShippingService(option.serviceCode)} /><span>{option.serviceName}</span><strong>{formatMarketMoney(option.amountInclGstCents, option.currency)}</strong></label>)}</div></fieldset> : null}<CheckoutOrderSummary cart={isReviewed ? reviewedCart : null} shipping={isReviewed ? shipping : null} />{hasPaymentAuthority ? <PaymentMethods methods={paymentMethods} value={selectedPaymentMethod} onChange={setSelectedPaymentMethod} disabled={checkoutLocked} /> : null}<button className={styles.primaryButton} type="button" disabled={paymentIntent ? Boolean(pending) : !hasPaymentAuthority || !selectedPaymentMethod || paymentMethods.length === 0 || Boolean(pending)} onClick={placeOrder}>{pending === "order" ? "Preparing payment…" : pending === "shipping" ? "Updating shipping…" : paymentIntent?.phase === "starting_payment" ? "Retry payment recovery" : paymentIntent ? "Retry order recovery" : selectedPaymentMethod === "card" ? "Continue to secure card payment" : selectedPaymentMethod === "afterpay" ? "Continue to Afterpay" : "Continue to payment"}</button></aside>
    </div>
  </>;
}
