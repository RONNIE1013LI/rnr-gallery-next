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
import { AddressForm, type AddressFieldErrors } from "./address-form";
import { CheckoutOrderSummary } from "./checkout-order-summary";
import styles from "./storefront.module.css";

export type CheckoutSavedAddress = AddressInput & { id: string };
const emptyAddress: AddressInput = { country: "NZ", fullName: "", building: "", street: "", suburb: "", region: "", postcode: "", phone: "", email: "" };
const IDEMPOTENCY_STORAGE_KEY = "rnr-checkout-order-idempotency-v1";
const PLACEMENT_STORAGE_KEY = "rnr-checkout-pending-placement-v1";

type PlacementIntent = {
  schemaVersion: 1;
  idempotencyKey: string;
  checkoutVersion: number;
  cartDigest: string;
  shipping: Pick<PublicShippingDTO["option"], "method" | "serviceCode" | "amountExGstCents" | "gstCents" | "amountInclGstCents" | "isTest">;
};

const recoveryRequests = new Map<string, Promise<unknown>>();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parsePlacementIntent(raw: string | null): PlacementIntent | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const intent = value as Record<string, unknown>;
    if (!hasExactKeys(intent, ["schemaVersion", "idempotencyKey", "checkoutVersion", "cartDigest", "shipping"])) return null;
    if (intent.schemaVersion !== 1 || typeof intent.idempotencyKey !== "string" || !isUuid(intent.idempotencyKey)) return null;
    if (!Number.isSafeInteger(intent.checkoutVersion) || (intent.checkoutVersion as number) < 1 || typeof intent.cartDigest !== "string" || !/^[0-9a-f]{64}$/.test(intent.cartDigest)) return null;
    if (!intent.shipping || typeof intent.shipping !== "object" || Array.isArray(intent.shipping)) return null;
    const shipping = intent.shipping as Record<string, unknown>;
    if (!hasExactKeys(shipping, ["method", "serviceCode", "amountExGstCents", "gstCents", "amountInclGstCents", "isTest"])) return null;
    if ((shipping.method !== "post" && shipping.method !== "pickup") || typeof shipping.serviceCode !== "string" || shipping.serviceCode.length < 1 || shipping.serviceCode.length > 100 || typeof shipping.isTest !== "boolean") return null;
    for (const key of ["amountExGstCents", "gstCents", "amountInclGstCents"] as const) {
      if (!Number.isSafeInteger(shipping[key]) || (shipping[key] as number) < 0) return null;
    }
    if ((shipping.amountExGstCents as number) + (shipping.gstCents as number) !== shipping.amountInclGstCents) return null;
    return value as PlacementIntent;
  } catch {
    return null;
  }
}

function readPlacementIntent() {
  if (typeof window === "undefined") return null;
  const intent = parsePlacementIntent(window.sessionStorage.getItem(PLACEMENT_STORAGE_KEY));
  if (!intent) window.sessionStorage.removeItem(PLACEMENT_STORAGE_KEY);
  return intent;
}

function placementRequest(intent: PlacementIntent) {
  return {
    idempotencyKey: intent.idempotencyKey,
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

function recoverPlacement(intent: PlacementIntent) {
  const key = JSON.stringify(intent);
  const existing = recoveryRequests.get(key);
  if (existing) return existing;
  const request = postJson("/api/checkout/order", placementRequest(intent)).finally(() => recoveryRequests.delete(key));
  recoveryRequests.set(key, request);
  return request;
}

function initialIdempotencyKey() {
  if (typeof window === "undefined") return "00000000-0000-4000-8000-000000000000";
  const stored = window.sessionStorage.getItem(IDEMPOTENCY_STORAGE_KEY);
  if (stored && isUuid(stored)) return stored;
  if (stored) {
    window.sessionStorage.removeItem(IDEMPOTENCY_STORAGE_KEY);
    window.sessionStorage.removeItem(PLACEMENT_STORAGE_KEY);
  }
  const created = window.crypto.randomUUID();
  window.sessionStorage.setItem(IDEMPOTENCY_STORAGE_KEY, created);
  return created;
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
  const [message, setMessage] = useState("");
  const [placementIntent, setPlacementIntent] = useState<PlacementIntent | null>(null);
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const [pending, setPending] = useState<"review" | "order" | null>(null);
  const [billingErrors, setBillingErrors] = useState<AddressFieldErrors>({});
  const [deliveryErrors, setDeliveryErrors] = useState<AddressFieldErrors>({});
  const [idempotencyKey, setIdempotencyKey] = useState("00000000-0000-4000-8000-000000000000");
  const [billingSavedId, setBillingSavedId] = useState(first?.id ?? "");
  const [deliverySavedId, setDeliverySavedId] = useState(first?.id ?? "");
  const reviewing = useRef(false);
  const placing = useRef(false);
  const currentKey = useMemo(() => JSON.stringify({ snapshot, billing, delivery: different ? delivery : billing, different, method }), [snapshot, billing, delivery, different, method]);
  const isReviewed = Boolean(reviewKey === currentKey && reviewedCart && reviewedVersion !== null && shipping);
  const checkoutLocked = Boolean(!recoveryChecked || pending || placementIntent);

  const completeOrder = useCallback((payload: { order: { orderNumber: string } }) => {
    createBrowserCartRepository(window.localStorage).clear();
    notifyCartChanged();
    window.sessionStorage.removeItem(IDEMPOTENCY_STORAGE_KEY);
    window.sessionStorage.removeItem(PLACEMENT_STORAGE_KEY);
    setPlacementIntent(null);
    push(`/orders/${payload.order.orderNumber}`);
  }, [push]);

  const invalidatePlacement = useCallback(() => {
    window.sessionStorage.removeItem(PLACEMENT_STORAGE_KEY);
    window.sessionStorage.removeItem(IDEMPOTENCY_STORAGE_KEY);
    const nextKey = window.crypto.randomUUID();
    window.sessionStorage.setItem(IDEMPOTENCY_STORAGE_KEY, nextKey);
    setIdempotencyKey(nextKey);
    setPlacementIntent(null);
    setReviewedCart(null);
    setReviewedVersion(null);
    setShipping(null);
    setReviewKey("");
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
      const intent = readPlacementIntent();
      if (!intent) {
        setIdempotencyKey(initialIdempotencyKey());
        setRecoveryChecked(true);
        return;
      }
      window.sessionStorage.setItem(IDEMPOTENCY_STORAGE_KEY, intent.idempotencyKey);
      setIdempotencyKey(intent.idempotencyKey);
      setPlacementIntent(intent);
      setPending("order");
      setRecoveryChecked(true);
      try {
        const payload = await recoverPlacement(intent);
        if (active) completeOrder(payload as { order: { orderNumber: string } });
      } catch (error) {
        if (active) handlePlacementFailure(error);
      }
    });
    return () => { active = false; };
  }, [completeOrder, handlePlacementFailure]);

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
      setReviewedCart(session.checkout.cart); setReviewedVersion(session.checkout.version); setShipping(quote.shipping.option); setReviewKey(currentKey);
      setMessage("Delivery and totals reviewed.");
    } catch (error) { const fields = (error as CheckoutApiError).fields as { billingAddress?: AddressFieldErrors; deliveryAddress?: AddressFieldErrors } | undefined; if (fields?.billingAddress) setBillingErrors(fields.billingAddress); if (fields?.deliveryAddress) setDeliveryErrors(fields.deliveryAddress); setReviewedCart(null); setReviewedVersion(null); setShipping(null); setReviewKey(""); setMessage(error instanceof Error ? error.message : "Could not review checkout. Choose Pickup or try again."); requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); }
    finally { reviewing.current = false; setPending(null); }
  }

  async function placeOrder() {
    if ((!isReviewed && !placementIntent) || pending || placing.current) return;
    placing.current = true;
    setPending("order"); setMessage("");
    const intent = placementIntent ?? {
      schemaVersion: 1,
      idempotencyKey,
      checkoutVersion: reviewedVersion!,
      cartDigest: reviewedCart!.cartDigest,
      shipping: { method: shipping!.method, serviceCode: shipping!.serviceCode, amountExGstCents: shipping!.amountExGstCents, gstCents: shipping!.gstCents, amountInclGstCents: shipping!.amountInclGstCents, isTest: shipping!.isTest },
    } satisfies PlacementIntent;
    if (!placementIntent) {
      window.sessionStorage.setItem(PLACEMENT_STORAGE_KEY, JSON.stringify(intent));
      setPlacementIntent(intent);
    }
    try {
      const payload = await postJson("/api/checkout/order", placementRequest(intent));
      completeOrder(payload);
    } catch (error) { handlePlacementFailure(error); }
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
    <aside className={styles.checkoutSummary}><p className={styles.eyebrow}>Your order</p><h2>Order summary</h2>{reviewedCart && !isReviewed ? <p className={styles.checkoutMessage}>Changes need review.</p> : null}<CheckoutOrderSummary cart={isReviewed ? reviewedCart : null} shipping={isReviewed ? shipping : null} /><button className={styles.primaryButton} type="button" disabled={(!isReviewed && !placementIntent) || Boolean(pending)} onClick={placeOrder}>{pending === "order" ? "Recovering order…" : placementIntent ? "Retry order recovery" : "Place order"}</button></aside>
  </div>;
}
