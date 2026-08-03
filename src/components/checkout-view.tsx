"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { AddressInput } from "@/domain/address/types";
import { addressInputSchema } from "@/domain/address/schema";
import { createBrowserCartRepository, parseStoredCart } from "@/domain/cart/browser-cart-repository";
import { EMPTY_CART_JSON, getCartSnapshot, notifyCartChanged, subscribeToCart } from "@/domain/cart/browser-cart-events";
import type { Cart } from "@/domain/cart/types";
import type { RepricedCheckoutCart } from "@/domain/checkout/types";
import type { PublicShippingDTO } from "@/server/checkout/public-dto";
import type { PaymentMethodKey } from "@/server/db/schema/payments";
import { createClientId } from "@/lib/client-id";
import { AddressForm, type AddressFieldErrors } from "./address-form";
import { CheckoutOrderSummary } from "./checkout-order-summary";
import { followPaymentAction, startOrderPayment } from "./order-payment-panel";
import { PaymentMethods, type PaymentMethodOption } from "./payment-methods";
import {
  PAYMENT_INTENT_STORAGE_KEY,
  readPaymentRecoveryIntent,
  type CheckoutStartingPaymentIntent,
  type PlacingOrderIntent,
} from "./payment-recovery-intent";
import styles from "./storefront.module.css";

export type CheckoutSavedAddress = AddressInput & { id: string };
const emptyAddress: AddressInput = { country: "NZ", fullName: "", building: "", street: "", suburb: "", region: "", postcode: "", phone: "", email: "" };
const LEGACY_IDEMPOTENCY_STORAGE_KEY = "rnr-checkout-order-idempotency-v1";
const LEGACY_PLACEMENT_STORAGE_KEY = "rnr-checkout-pending-placement-v1";
type CheckoutPaymentIntent = PlacingOrderIntent | CheckoutStartingPaymentIntent;

const recoveryRequests = new Map<string, Promise<unknown>>();
function readPaymentIntent() {
  if (typeof window === "undefined") return null;
  const intent = readPaymentRecoveryIntent(window.sessionStorage);
  window.sessionStorage.removeItem(LEGACY_IDEMPOTENCY_STORAGE_KEY);
  window.sessionStorage.removeItem(LEGACY_PLACEMENT_STORAGE_KEY);
  return intent && "orderIdempotencyKey" in intent ? intent : null;
}

function placementRequest(intent: CheckoutPaymentIntent) {
  return {
    idempotencyKey: intent.orderIdempotencyKey,
    checkoutVersion: intent.checkoutVersion,
    cartDigest: intent.cartDigest,
    shipping: intent.shipping,
  };
}

function addressInput(address: AddressInput): AddressInput {
  const { country, fullName, building, street, suburb, region, postcode, phone, email } = address;
  return { country, fullName, building, street, suburb, region, postcode, phone, email };
}

export function canonicalCheckoutCart(cart: Cart) {
  return { version: 1 as const, items: cart.items.map((item) => ({
    clientItemId: item.id, productKey: item.productKey, sizeKey: item.sizeKey,
    ...(item.galleryDesignId ? { galleryDesignId: item.galleryDesignId } : {}),
    ...(item.orientation ? { orientation: item.orientation } : {}),
    peoplePets: item.peoplePets, photoSubmissionMethod: item.photoSubmissionMethod,
    designText: item.designText, notes: item.notes, neededDate: item.neededDate,
    urgentServiceConfirmed: item.urgentServiceConfirmed === true,
    quantity: item.quantity, uploadReferences: [...item.uploadReferences],
  })) };
}

class CheckoutApiError extends Error { constructor(message: string, readonly code: string | undefined, readonly status: number, readonly fields?: unknown) { super(message); } }
async function postJson(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json();
  if (!response.ok) throw new CheckoutApiError(payload.error?.message ?? "Request failed", payload.error?.code, response.status, payload.error?.fields);
  return payload;
}

function recoverRequest<T>(key: string, request: () => Promise<T>) {
  const existing = recoveryRequests.get(key);
  if (existing) return existing as Promise<T>;
  const pending = request().finally(() => recoveryRequests.delete(key));
  recoveryRequests.set(key, pending);
  return pending;
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

export function CheckoutView({ savedAddresses = [] }: { savedAddresses?: CheckoutSavedAddress[] }) {
  const { push } = useRouter();
  const snapshot = useSyncExternalStore(subscribeToCart, getCartSnapshot, () => EMPTY_CART_JSON);
  const cart = parseStoredCart(snapshot);
  const first = savedAddresses[0];
  const [billing, setBilling] = useState<AddressInput>(first ? addressInput(first) : emptyAddress);
  const [different, setDifferent] = useState(false);
  const [delivery, setDelivery] = useState<AddressInput>(first ? addressInput(first) : emptyAddress);
  const [method, setMethod] = useState<"post" | "pickup">("post");
  const [reviewedCart, setReviewedCart] = useState<RepricedCheckoutCart | null>(null);
  const [reviewedVersion, setReviewedVersion] = useState<number | null>(null);
  const [shipping, setShipping] = useState<PublicShippingDTO["option"] | null>(null);
  const [reviewKey, setReviewKey] = useState("");
  const [paymentMethods, setPaymentMethods] = useState<readonly PaymentMethodOption[]>([]);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethodKey | null>(null);
  const [paymentReviewKey, setPaymentReviewKey] = useState("");
  const [message, setMessage] = useState("");
  const [paymentIntent, setPaymentIntent] = useState<CheckoutPaymentIntent | null>(null);
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const [pending, setPending] = useState<"review" | "order" | null>(null);
  const [billingErrors, setBillingErrors] = useState<AddressFieldErrors>({});
  const [deliveryErrors, setDeliveryErrors] = useState<AddressFieldErrors>({});
  const [billingSavedId, setBillingSavedId] = useState(first?.id ?? "");
  const [deliverySavedId, setDeliverySavedId] = useState(first?.id ?? "");
  const reviewing = useRef(false);
  const placing = useRef(false);
  const currentKey = useMemo(() => JSON.stringify({ snapshot, billing, delivery: different ? delivery : billing, different, method }), [snapshot, billing, delivery, different, method]);
  const isReviewed = Boolean(reviewKey === currentKey && reviewedCart && reviewedVersion !== null && shipping);
  const hasPaymentAuthority = Boolean(isReviewed && paymentReviewKey === currentKey);
  const checkoutLocked = Boolean(!recoveryChecked || pending || paymentIntent);

  const clearPlacedCart = useCallback(() => {
    createBrowserCartRepository(window.localStorage).clear();
    notifyCartChanged();
  }, []);

  const finishPaymentStart = useCallback(async (orderNumber: string, payload: Awaited<ReturnType<typeof startOrderPayment>>) => {
    const orderHref = `/orders/${orderNumber}`;
    if (payload.action) {
      await followPaymentAction(payload.action, orderHref, {
        assign: (url) => window.location.assign(url),
        navigate: push,
      });
      return;
    }
    if (["paid", "failed", "cancelled"].includes(payload.payment.status)) {
      window.sessionStorage.removeItem(PAYMENT_INTENT_STORAGE_KEY);
      setPaymentIntent(null);
    }
    push(`${orderHref}#payment`);
  }, [push]);

  const invalidatePlacement = useCallback(() => {
    window.sessionStorage.removeItem(PAYMENT_INTENT_STORAGE_KEY);
    setPaymentIntent(null);
    setReviewedCart(null);
    setReviewedVersion(null);
    setShipping(null);
    setReviewKey("");
    setPaymentMethods([]);
    setSelectedPaymentMethod(null);
    setPaymentReviewKey("");
    setMessage("Checkout changed. Review delivery and totals again.");
  }, []);

  const handlePlacementFailure = useCallback((error: unknown) => {
    placing.current = false;
    if (error instanceof CheckoutApiError && error.code === "CHECKOUT_CHANGED") invalidatePlacement();
    else setMessage(error instanceof Error ? error.message : "Order could not be created.");
    setPending(null);
  }, [invalidatePlacement]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      const intent = readPaymentIntent();
      if (!intent) {
        setRecoveryChecked(true);
        return;
      }
      setPaymentIntent(intent);
      setPending("order");
      setRecoveryChecked(true);
      try {
        let starting: CheckoutStartingPaymentIntent;
        if (intent.phase === "placing_order") {
          const payload = await recoverRequest(`order:${JSON.stringify(intent)}`, () => postJson("/api/checkout/order", placementRequest(intent))) as { order: { orderNumber: string } };
          starting = { ...intent, phase: "starting_payment", orderNumber: payload.order.orderNumber };
          window.sessionStorage.setItem(PAYMENT_INTENT_STORAGE_KEY, JSON.stringify(starting));
          if (active) setPaymentIntent(starting);
        } else starting = intent;
        clearPlacedCart();
        const payment = await recoverRequest(`payment:${JSON.stringify(starting)}`, () => startOrderPayment(starting.orderNumber, starting.method, starting.paymentIdempotencyKey));
        if (active) await finishPaymentStart(starting.orderNumber, payment);
      } catch (error) {
        if (active) {
          handlePlacementFailure(error);
          const current = readPaymentIntent();
          if (current?.phase === "starting_payment") push(`/orders/${current.orderNumber}#payment`);
        }
      }
    });
    return () => { active = false; };
  }, [clearPlacedCart, finishPaymentStart, handlePlacementFailure, push]);

  if (cart.items.length === 0) return <section className={styles.cartEmpty}><h2>Your cart is empty</h2><Link className={styles.primaryButton} href="/shop">Explore products</Link></section>;

  async function review() {
    if (reviewing.current || checkoutLocked) return;
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
    reviewing.current = true;
    setPending("review");
    try {
      const session = await postJson("/api/checkout/session", { cart: canonicalCheckoutCart(cart), billingAddress: billing, useDifferentDeliveryAddress: different, ...(different ? { deliveryAddress: delivery } : {}), deliveryMethod: method });
      const quote = await postJson("/api/checkout/shipping", {});
      const payment = await postJson("/api/checkout/payment-methods", { checkoutVersion: session.checkout.version, cartDigest: session.checkout.cart.cartDigest }) as { methods: readonly PaymentMethodOption[] };
      setReviewedCart(session.checkout.cart); setReviewedVersion(session.checkout.version); setShipping(quote.shipping.option); setReviewKey(currentKey);
      setPaymentMethods(payment.methods);
      setSelectedPaymentMethod(payment.methods.find((option) => option.method === "card")?.method ?? payment.methods[0]?.method ?? null);
      setPaymentReviewKey(currentKey);
      setMessage("Delivery and totals reviewed.");
    } catch (error) { const fields = (error as CheckoutApiError).fields as { billingAddress?: AddressFieldErrors; deliveryAddress?: AddressFieldErrors } | undefined; if (fields?.billingAddress) setBillingErrors(fields.billingAddress); if (fields?.deliveryAddress) setDeliveryErrors(fields.deliveryAddress); setReviewedCart(null); setReviewedVersion(null); setShipping(null); setReviewKey(""); setPaymentMethods([]); setSelectedPaymentMethod(null); setPaymentReviewKey(""); setMessage(error instanceof Error ? error.message : "Could not review checkout. Choose Pickup or try again."); requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); }
    finally { reviewing.current = false; setPending(null); }
  }

  async function placeOrder() {
    if ((!paymentIntent && (!isReviewed || !selectedPaymentMethod || !hasPaymentAuthority)) || pending || placing.current) return;
    placing.current = true;
    setPending("order"); setMessage("");
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
    if (!paymentIntent) {
      window.sessionStorage.setItem(PAYMENT_INTENT_STORAGE_KEY, JSON.stringify(intent));
      setPaymentIntent(intent);
    }
    try {
      let starting: CheckoutStartingPaymentIntent;
      if (intent.phase === "placing_order") {
        const payload = await postJson("/api/checkout/order", placementRequest(intent));
        starting = { ...intent, phase: "starting_payment", orderNumber: payload.order.orderNumber };
        window.sessionStorage.setItem(PAYMENT_INTENT_STORAGE_KEY, JSON.stringify(starting));
        setPaymentIntent(starting);
      } else starting = intent;
      clearPlacedCart();
      const payment = await startOrderPayment(starting.orderNumber, starting.method, starting.paymentIdempotencyKey);
      await finishPaymentStart(starting.orderNumber, payment);
    } catch (error) {
      handlePlacementFailure(error);
      const current = readPaymentIntent();
      if (current?.phase === "starting_payment") push(`/orders/${current.orderNumber}#payment`);
    }
  }

  return <div className={styles.checkoutLayout}>
    <form aria-label="Checkout details" className={styles.checkoutForm} noValidate onSubmit={(event) => { event.preventDefault(); void review(); }}>
      {savedAddresses.length ? <label className={styles.savedAddressSelect}>Saved billing address<select disabled={checkoutLocked} value={billingSavedId} onChange={(event) => { setBillingSavedId(event.target.value); const selected = savedAddresses.find((address) => address.id === event.target.value); if (selected) setBilling(addressInput(selected)); }}><option value="">Enter manually</option>{savedAddresses.map((address) => <option key={address.id} value={address.id}>{address.fullName} · {address.street}</option>)}</select></label> : null}
      <fieldset><legend>Billing address</legend><AddressForm value={billing} onChange={setBilling} errors={billingErrors} disabled={checkoutLocked} /></fieldset>
      <label className={styles.checkoutToggle}><input disabled={checkoutLocked} type="checkbox" checked={different} onChange={(event) => setDifferent(event.target.checked)} /> Deliver to a different address</label>
      {different ? <fieldset><legend>Delivery address</legend>{savedAddresses.length ? <label className={styles.savedAddressSelect}>Saved delivery address<select disabled={checkoutLocked} value={deliverySavedId} onChange={(event) => { setDeliverySavedId(event.target.value); const selected = savedAddresses.find((address) => address.id === event.target.value); if (selected) setDelivery(addressInput(selected)); }}><option value="">Enter manually</option>{savedAddresses.map((address) => <option key={address.id} value={address.id}>{address.fullName} · {address.street}</option>)}</select></label> : null}<AddressForm value={delivery} onChange={setDelivery} errors={deliveryErrors} disabled={checkoutLocked} /></fieldset> : null}
      <fieldset><legend>Delivery</legend><div className={styles.deliveryChoices}><label><input disabled={checkoutLocked} type="radio" name="deliveryMethod" checked={method === "post"} onChange={() => setMethod("post")} /> Post</label><label><input disabled={checkoutLocked} type="radio" name="deliveryMethod" checked={method === "pickup"} onChange={() => setMethod("pickup")} /> Pickup</label></div></fieldset>
      <button className={styles.secondaryButton} type="submit" disabled={checkoutLocked}>{!recoveryChecked ? "Checking order status…" : pending === "review" ? "Reviewing…" : "Review delivery & totals"}</button>
      <p aria-live="polite" className={styles.checkoutMessage}>{message}</p>
    </form>
    <aside className={styles.checkoutSummary}><p className={styles.eyebrow}>Your order</p><h2>Order summary</h2>{reviewedCart && !isReviewed ? <p className={styles.checkoutMessage}>Changes need review.</p> : null}<CheckoutOrderSummary cart={isReviewed ? reviewedCart : null} shipping={isReviewed ? shipping : null} />{hasPaymentAuthority ? <PaymentMethods methods={paymentMethods} value={selectedPaymentMethod} onChange={setSelectedPaymentMethod} disabled={checkoutLocked} /> : null}<button className={styles.primaryButton} type="button" disabled={paymentIntent ? Boolean(pending) : !hasPaymentAuthority || !selectedPaymentMethod || paymentMethods.length === 0 || Boolean(pending)} onClick={placeOrder}>{pending === "order" ? "Starting order…" : paymentIntent?.phase === "starting_payment" ? "Retry payment recovery" : paymentIntent ? "Retry order recovery" : "Place order"}</button></aside>
  </div>;
}
