"use client";

import { useRef, useState, type FormEvent } from "react";
import type { MarketCurrency } from "@/domain/markets/types";
import { formatMarketMoney } from "@/domain/money";
import type { PaymentMethodKey } from "@/server/db/schema/payments";
import type { PublicPaymentMethod, PaymentStartResult } from "@/server/payments/payment-service";
import { StripePaymentForm } from "./stripe-payment-form";
import styles from "./payment-request.module.css";

type Address = Readonly<{
  country: "NZ" | "AU";
  building: string;
  street: string;
  suburb: string;
  region: string;
  postcode: string;
}>;

function tokenFromPathname(pathname: string) {
  const match = pathname.match(/^\/pay\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function safeRedirect(raw: string) {
  const url = new URL(raw, window.location.origin);
  return url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "localhost")
    ? url.href
    : null;
}

function idempotencyKey(keys: Map<PaymentMethodKey, string>, method: PaymentMethodKey) {
  const existing = keys.get(method);
  if (existing) return existing;
  const created = window.crypto?.randomUUID?.() ??
    `payment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  keys.set(method, created);
  return created;
}

export function PaymentRequestForm({
  amountCents,
  currency,
  methods,
}: Readonly<{
  amountCents: number;
  currency: MarketCurrency;
  methods: readonly PublicPaymentMethod[];
}>) {
  const [method, setMethod] = useState<PaymentMethodKey>(methods[0]?.method ?? "card");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState<Address>({
    country: currency === "AUD" ? "AU" : "NZ",
    building: "", street: "", suburb: "", region: "", postcode: "",
  });
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [started, setStarted] = useState<PaymentStartResult | null>(null);
  const keys = useRef(new Map<PaymentMethodKey, string>());

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const token = tokenFromPathname(window.location.pathname);
    if (!token) {
      setMessage("Payment request is unavailable.");
      return;
    }
    setPending(true);
    setMessage("");
    try {
      const body = {
        method,
        fullName,
        email,
        idempotencyKey: idempotencyKey(keys.current, method),
        ...(phone.trim() ? { phone } : {}),
        ...(method === "afterpay" || method === "zip" ? { address } : {}),
      };
      const response = await fetch(`/api/payment-requests/${encodeURIComponent(token)}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as PaymentStartResult | { error?: string };
      if (!response.ok || !("payment" in payload)) {
        throw new Error("error" in payload && payload.error ? payload.error : "Payment could not be started");
      }
      setStarted(payload);
      if (payload.action?.kind === "redirect" || payload.action?.kind === "test") {
        const target = safeRedirect(payload.action.redirectUrl);
        if (!target) throw new Error("Payment could not be started");
        window.location.assign(target);
      }
    } catch (error) {
      setMessage(error instanceof Error && error.message.length <= 200
        ? error.message
        : "Payment could not be started");
    } finally {
      setPending(false);
    }
  }

  if (started?.action?.kind === "elements") {
    return <div className={styles.paymentArea}>
      <h2>Secure card payment</h2>
      <StripePaymentForm
        clientSecret={started.action.clientSecret}
        confirmationUrl=""
        currency={currency}
        forceRedirect
        publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""}
        returnUrl={started.action.returnUrl}
        totalInclGstCents={amountCents}
      />
    </div>;
  }

  if (methods.length === 0) {
    return <p className={styles.status} role="status">No payment method is currently available. Please contact R&R Gallery.</p>;
  }

  const needsAddress = method === "afterpay" || method === "zip";
  return <form className={styles.form} onSubmit={submit}>
    <h2>Pay securely</h2>
    <fieldset className={styles.methods}>
      <legend>Payment method</legend>
      {methods.map((option) => <label key={option.method}>
        <input
          checked={method === option.method}
          name="payment-method"
          onChange={() => setMethod(option.method)}
          type="radio"
          value={option.method}
        />
        <span>{option.label}</span>
        {option.isTest ? <small>Test mode</small> : null}
      </label>)}
    </fieldset>
    <div className={styles.fields}>
      <label><span>Full name</span><input autoComplete="name" required value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
      <label><span>Email</span><input autoComplete="email" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label><span>Phone{method === "card" ? " (optional)" : ""}</span><input autoComplete="tel" required={needsAddress} type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
      {needsAddress ? <>
        <label><span>Country</span><select aria-label="Country" value={address.country} disabled>
          {address.country === "NZ" ? <option value="NZ">New Zealand</option> : null}
          {address.country === "AU" ? <option value="AU">Australia</option> : null}
        </select></label>
        <label><span>Building / unit (optional)</span><input autoComplete="address-line1" value={address.building} onChange={(event) => setAddress({ ...address, building: event.target.value })} /></label>
        <label><span>Street address</span><input aria-label="Street address" autoComplete="address-line2" required value={address.street} onChange={(event) => setAddress({ ...address, street: event.target.value })} /></label>
        <label><span>Suburb</span><input autoComplete="address-level3" required value={address.suburb} onChange={(event) => setAddress({ ...address, suburb: event.target.value })} /></label>
        <label><span>Region</span><input autoComplete="address-level1" required value={address.region} onChange={(event) => setAddress({ ...address, region: event.target.value })} /></label>
        <label><span>Postcode</span><input autoComplete="postal-code" inputMode="numeric" pattern="[0-9]{4}" required value={address.postcode} onChange={(event) => setAddress({ ...address, postcode: event.target.value })} /></label>
      </> : null}
    </div>
    <button className={styles.payButton} disabled={pending} type="submit">
      {pending ? "Starting payment…" : `Pay ${formatMarketMoney(amountCents, currency)}`}
    </button>
    {message ? <p className={styles.message} role="alert">{message}</p> : null}
  </form>;
}
