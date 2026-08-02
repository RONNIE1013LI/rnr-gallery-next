"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
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

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json();
  if (!response.ok) throw Object.assign(new Error(payload.error?.message ?? "Request failed"), { fields: payload.error?.fields });
  return payload;
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
  const router = useRouter();
  const snapshot = useSyncExternalStore(subscribeToCart, getCartSnapshot, () => EMPTY_CART_JSON);
  const cart = parseStoredCart(snapshot);
  const first = savedAddresses[0];
  const [billing, setBilling] = useState<AddressInput>(first ? addressInput(first) : emptyAddress);
  const [different, setDifferent] = useState(false);
  const [delivery, setDelivery] = useState<AddressInput>(first ? addressInput(first) : emptyAddress);
  const [method, setMethod] = useState<"post" | "pickup">("post");
  const [reviewedCart, setReviewedCart] = useState<RepricedCheckoutCart | null>(null);
  const [shipping, setShipping] = useState<PublicShippingDTO["option"] | null>(null);
  const [reviewKey, setReviewKey] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<"review" | "order" | null>(null);
  const [billingErrors, setBillingErrors] = useState<AddressFieldErrors>({});
  const [deliveryErrors, setDeliveryErrors] = useState<AddressFieldErrors>({});
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const placing = useRef(false);
  const currentKey = useMemo(() => JSON.stringify({ snapshot, billing, delivery: different ? delivery : billing, different, method }), [snapshot, billing, delivery, different, method]);
  const isReviewed = Boolean(reviewKey === currentKey && reviewedCart && shipping);

  if (cart.items.length === 0) return <section className={styles.cartEmpty}><h1>Your cart is empty</h1><Link className={styles.primaryButton} href="/shop">Explore products</Link></section>;

  async function review() {
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
    setPending("review");
    try {
      const session = await postJson("/api/checkout/session", { cart: canonicalCheckoutCart(cart), billingAddress: billing, useDifferentDeliveryAddress: different, ...(different ? { deliveryAddress: delivery } : {}), deliveryMethod: method });
      const quote = await postJson("/api/checkout/shipping", {});
      setReviewedCart(session.checkout.cart); setShipping(quote.shipping.option); setReviewKey(currentKey);
      setMessage("Delivery and totals reviewed.");
    } catch (error) { const fields = (error as { fields?: { billingAddress?: AddressFieldErrors; deliveryAddress?: AddressFieldErrors } }).fields; if (fields?.billingAddress) setBillingErrors(fields.billingAddress); if (fields?.deliveryAddress) setDeliveryErrors(fields.deliveryAddress); setReviewedCart(null); setShipping(null); setReviewKey(""); setMessage(error instanceof Error ? error.message : "Could not review checkout. Choose Pickup or try again."); requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); }
    finally { setPending(null); }
  }

  async function placeOrder() {
    if (!isReviewed || pending || placing.current) return;
    placing.current = true;
    setPending("order"); setMessage("");
    try {
      const payload = await postJson("/api/checkout/order", { idempotencyKey });
      createBrowserCartRepository(window.localStorage).clear(); notifyCartChanged();
      setIdempotencyKey(crypto.randomUUID()); router.push(`/orders/${payload.order.orderNumber}`);
    } catch (error) { placing.current = false; setMessage(error instanceof Error ? error.message : "Order could not be created."); setPending(null); }
  }

  return <div className={styles.checkoutLayout}>
    <form className={styles.checkoutForm} onSubmit={(event) => event.preventDefault()}>
      {savedAddresses.length ? <label className={styles.savedAddressSelect}>Saved address<select value="" onChange={(event) => { const selected = savedAddresses.find((address) => address.id === event.target.value); if (selected) { setBilling(addressInput(selected)); setDelivery(addressInput(selected)); } }}><option value="">Choose an address</option>{savedAddresses.map((address) => <option key={address.id} value={address.id}>{address.fullName} · {address.street}</option>)}</select></label> : null}
      <fieldset><legend>Billing address</legend><AddressForm value={billing} onChange={setBilling} errors={billingErrors} disabled={Boolean(pending)} /></fieldset>
      <label className={styles.checkoutToggle}><input type="checkbox" checked={different} onChange={(event) => setDifferent(event.target.checked)} /> Deliver to a different address</label>
      {different ? <fieldset><legend>Delivery address</legend><AddressForm value={delivery} onChange={setDelivery} errors={deliveryErrors} disabled={Boolean(pending)} /></fieldset> : null}
      <fieldset><legend>Delivery</legend><div className={styles.deliveryChoices}><label><input type="radio" name="deliveryMethod" checked={method === "post"} onChange={() => setMethod("post")} /> Post</label><label><input type="radio" name="deliveryMethod" checked={method === "pickup"} onChange={() => setMethod("pickup")} /> Pickup</label></div></fieldset>
      <button className={styles.secondaryButton} type="button" onClick={review} disabled={Boolean(pending)}>{pending === "review" ? "Reviewing…" : "Review delivery & totals"}</button>
      <p aria-live="polite" className={styles.checkoutMessage}>{message}</p>
    </form>
    <aside className={styles.checkoutSummary}><p className={styles.eyebrow}>Your order</p><h2>Order summary</h2>{reviewedCart && !isReviewed ? <p className={styles.checkoutMessage}>Changes need review.</p> : null}<CheckoutOrderSummary cart={isReviewed ? reviewedCart : null} shipping={isReviewed ? shipping : null} /><button className={styles.primaryButton} type="button" disabled={!isReviewed || Boolean(pending)} onClick={placeOrder}>{pending === "order" ? "Placing order…" : "Place order"}</button></aside>
  </div>;
}
