"use client";

import { useState, type FormEvent } from "react";
import type { MarketCurrency } from "@/domain/markets/types";
import type { PaymentMethodKey } from "@/server/db/schema/payments";
import styles from "./admin.module.css";

type LinkedOrder = Readonly<{
  id: string;
  orderNumber: string;
  currency: MarketCurrency;
  unreservedCents: number;
}>;

const MAX_STANDALONE_PAYMENT_REQUEST_CENTS = 100_000_000;

function nextKey() {
  return globalThis.crypto?.randomUUID?.() ??
    `payment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function PaymentRequestForm({ linkedOrder }: Readonly<{ linkedOrder?: LinkedOrder }>) {
  const [currency, setCurrency] = useState<MarketCurrency>(linkedOrder?.currency ?? "NZD");
  const [amount, setAmount] = useState(
    linkedOrder ? String(linkedOrder.unreservedCents / 100) : "0",
  );
  const [description, setDescription] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [methods, setMethods] = useState<PaymentMethodKey[]>(["card"]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [paymentUrl, setPaymentUrl] = useState("");
  const [requestId, setRequestId] = useState("");
  const [idempotencyKey] = useState(nextKey);

  function toggleMethod(method: PaymentMethodKey) {
    setMethods((current) => current.includes(method)
      ? current.filter((candidate) => candidate !== method)
      : [...current, method]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || methods.length === 0) return;
    const normalizedAmount = amount.trim();
    const amountMatch = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalizedAmount);
    const amountCents = amountMatch
      ? Number(amountMatch[1]) * 100 + Number((amountMatch[2] ?? "").padEnd(2, "0"))
      : Number.NaN;
    if (
      !amountMatch ||
      !Number.isSafeInteger(amountCents) ||
      amountCents <= 0 ||
      (!linkedOrder && amountCents > MAX_STANDALONE_PAYMENT_REQUEST_CENTS) ||
      (linkedOrder && amountCents > linkedOrder.unreservedCents)
    ) {
      setMessage("Enter a valid amount with no more than two decimal places.");
      return;
    }
    setPending(true);
    setMessage("");
    setPaymentUrl("");
    try {
      const body = linkedOrder ? {
        kind: "order_balance" as const,
        orderId: linkedOrder.id,
        idempotencyKey,
        amountCents,
        currency: linkedOrder.currency,
        description,
        enabledPaymentMethods: methods,
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
        ...(internalNote.trim() ? { internalNote } : {}),
      } : {
        kind: "standalone" as const,
        idempotencyKey,
        amountCents,
        currency,
        description,
        enabledPaymentMethods: methods,
        ...(customerName.trim() ? { customerName } : {}),
        ...(customerEmail.trim() ? { customerEmail } : {}),
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
        ...(internalNote.trim() ? { internalNote } : {}),
      };
      const response = await fetch("/api/admin/payment-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as {
        error?: string;
        paymentUrl?: string;
        request?: { id?: string; requestNumber?: string };
      };
      if (!response.ok || !payload.request?.id) {
        throw new Error(payload.error || "Payment request could not be created");
      }
      setRequestId(payload.request.id);
      if (payload.paymentUrl) {
        setPaymentUrl(payload.paymentUrl);
        setMessage("Payment request created. Copy this one-time link now.");
      } else {
        setMessage("This request already exists. Rotate its link from the request detail page if needed.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Payment request could not be created");
    } finally {
      setPending(false);
    }
  }

  return <form className={styles.formPanel} onSubmit={submit}>
    {linkedOrder ? <div className={styles.safetyBanner} role="note">
      <strong>Order {linkedOrder.orderNumber}</strong>
      <p>The amount defaults to the current unreserved balance and will be checked again before payment starts.</p>
    </div> : null}
    <div className={styles.formGrid}>
      <label><span>Currency</span><select aria-label="Currency" disabled={Boolean(linkedOrder)} value={currency} onChange={(event) => setCurrency(event.target.value as MarketCurrency)}><option value="NZD">NZD</option><option value="AUD">AUD</option></select></label>
      <label><span>Amount</span><input aria-label="Amount" min="0.01" max={linkedOrder ? linkedOrder.unreservedCents / 100 : MAX_STANDALONE_PAYMENT_REQUEST_CENTS / 100} required step="0.01" type="number" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      <label className={styles.paymentRequestWideField}><span>Description</span><input aria-label="Description" maxLength={500} required value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      {!linkedOrder ? <>
        <label><span>Customer name (optional)</span><input aria-label="Customer name (optional)" maxLength={120} value={customerName} onChange={(event) => setCustomerName(event.target.value)} /></label>
        <label><span>Customer email (optional)</span><input aria-label="Customer email (optional)" maxLength={320} type="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} /></label>
      </> : null}
      <label><span>Expires at (optional)</span><input aria-label="Expires at (optional)" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
      <label className={styles.paymentRequestWideField}><span>Internal note (optional)</span><textarea aria-label="Internal note (optional)" maxLength={2000} value={internalNote} onChange={(event) => setInternalNote(event.target.value)} /></label>
    </div>
    <fieldset className={styles.paymentRequestMethods}>
      <legend>Enabled payment methods</legend>
      {(["card", "afterpay"] as const).map((method) => <label key={method}>
        <input checked={methods.includes(method)} onChange={() => toggleMethod(method)} type="checkbox" />
        <span>{method === "card" ? "Card" : "Afterpay"}</span>
      </label>)}
    </fieldset>
    <div className={styles.formSubmitBar}>
      <p>{message || "The customer must pay the fixed amount in one complete payment."}</p>
      <button disabled={pending || methods.length === 0} type="submit">{pending ? "Creating…" : "Create payment request"}</button>
    </div>
    {paymentUrl ? <div className={styles.oneTimeLink} role="status">
      <strong>One-time payment link — shown only once</strong>
      <p>{paymentUrl}</p>
      <button type="button" onClick={() => navigator.clipboard.writeText(paymentUrl)}>Copy payment link</button>
    </div> : null}
    {requestId ? <a className={styles.tableAction} href={`/admin/payment-requests/${requestId}`}>Open payment request</a> : null}
  </form>;
}
