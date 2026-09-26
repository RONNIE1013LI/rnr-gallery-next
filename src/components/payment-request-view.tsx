"use client";

import { useEffect, useRef, useState } from "react";
import { formatMarketMoney } from "@/domain/money";
import type { PublicPaymentRequestDTO } from "@/server/payment-requests/types";
import type { PublicPaymentMethod } from "@/server/payments/payment-service";
import { PaymentRequestForm } from "./payment-request-form";
import styles from "./payment-request.module.css";

function countdown(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((part) => String(part).padStart(2, "0")).join(":");
}

export function PaymentRequestView({ request: initialRequest, methods }: Readonly<{
  request: PublicPaymentRequestDTO;
  methods: readonly PublicPaymentMethod[];
}>) {
  const [request, setRequest] = useState(initialRequest);
  const [activated, setActivated] = useState(false);
  const [activationFailed, setActivationFailed] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const anchor = useRef<{ remaining: number; receivedAt: number } | null>(null);

  useEffect(() => {
    if (initialRequest.status === "paid" || initialRequest.status === "cancelled" || initialRequest.status === "invalidated") return;
    const match = window.location.pathname.match(/^\/pay\/([^/]+)\/?$/);
    if (!match) return;
    const endpoint = `/api/payment-requests/${encodeURIComponent(decodeURIComponent(match[1]))}`;
    let disposed = false;
    let opened = initialRequest.status !== "pending";
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function refresh() {
      const sentAt = performance.now();
      try {
        const response = await fetch(opened ? endpoint : `${endpoint}/open`, {
          method: opened ? "GET" : "POST", cache: "no-store", signal: controller.signal,
        });
        const payload = await response.json() as { request?: PublicPaymentRequestDTO };
        if (!response.ok || !payload.request) throw new Error("Unavailable");
        if (disposed) return;
        const latest = payload.request;
        setRequest((current) => current.status === "paid" ? current : latest);
        setActivationFailed(false);
        if (latest.expiresAt && latest.serverNow) {
          // Subtract transport time conservatively; browser wall-clock changes cannot extend validity.
          const duration = Date.parse(latest.expiresAt) - Date.parse(latest.serverNow) - (performance.now() - sentAt);
          if (!Number.isFinite(duration)) throw new Error("Invalid payment deadline");
          const receivedAt = performance.now();
          const previousRemaining = anchor.current
            ? anchor.current.remaining - (receivedAt - anchor.current.receivedAt)
            : duration;
          const boundedRemaining = Math.max(0, Math.min(duration, previousRemaining));
          anchor.current = { remaining: boundedRemaining, receivedAt };
          setRemaining(boundedRemaining);
          opened = true;
          setActivated(true);
        }
        if (latest.status === "paid" || latest.status === "cancelled" || latest.status === "invalidated") return;
      } catch {
        if (disposed) return;
        if (!opened) setActivationFailed(true);
      }
      if (!disposed) timer = setTimeout(refresh, 5000);
    }
    void refresh();
    const tick = setInterval(() => {
      if (anchor.current) setRemaining(Math.max(0, anchor.current.remaining - (performance.now() - anchor.current.receivedAt)));
    }, 1000);
    return () => { disposed = true; controller.abort(); clearTimeout(timer); clearInterval(tick); };
  }, [initialRequest.status]);

  const paid = request.status === "paid";
  const expired = !paid && (request.status !== "pending" || remaining === 0);
  const amount = formatMarketMoney(request.amountCents, request.currency);
  const urgency = remaining !== null && remaining <= 5 * 60_000 ? styles.deadlineUrgent
    : remaining !== null && remaining <= 15 * 60_000 ? styles.deadlineSoon
    : remaining !== null && remaining <= 60 * 60_000 ? styles.deadlineWarning : "";
  return <main id="main-content" className={styles.page}>
    <section className={styles.card} aria-labelledby="payment-request-title">
      <p className={styles.eyebrow}>Secure payment</p>
      <header className={styles.header}>
        <h1 id="payment-request-title">{paid ? "Payment completed" : expired ? "Payment link expired" : "Payment request"}</h1>
        {!paid && !expired ? <p className={styles.requestSubhead}>Complete this one-time payment to confirm your order</p> : null}
      </header>
      <div className={styles.summaryWrap}>
        <dl className={styles.summary}>
          <div><dt>Reference</dt><dd>{request.requestNumber}</dd></div>
          {request.orderNumber ? <div><dt>Order</dt><dd>{request.orderNumber}</dd></div> : null}
          <div><dt>Description</dt><dd>{request.description}</dd></div>
          <div className={styles.total}><dt>{paid ? "Amount paid" : "Amount to pay"}</dt><dd>{amount}</dd></div>
        </dl>
      </div>
      {paid ? <div className={`${styles.status} ${styles.success}`} role="status">
        <p>This payment request has already been paid.</p><p>No further payment is required.</p>
      </div> : expired ? <div className={styles.status} role="status">
        <p>This payment link has expired.</p>
        <p>Please contact R&amp;R Gallery to request a new payment link.</p>
        <p className={styles.formHint}>This payment link was valid for 12 hours after it was first opened.</p>
        <a className={styles.payButton} href="/contact">Contact R&amp;R Gallery for a new payment link</a>
      </div> : activated && remaining !== null ? <>
        <section className={`${styles.status} ${styles.deadline} ${urgency}`} aria-label="Payment link validity">
          <h2>Payment link valid for 12 hours</h2>
          <p className={styles.formHint}>This payment link is valid for 12 hours after it is first opened.</p>
          <p>{remaining <= 15 * 60_000 ? "Payment link expiring soon" : "Payment link expires in"}</p>
          <p className={styles.countdown} role="timer" aria-label="Time remaining">{countdown(remaining)}</p>
          <p className={styles.formHint}>You may share this link with a family member or friend if they are helping you complete the payment.</p>
        </section>
        <PaymentRequestForm amountCents={request.amountCents} currency={request.currency} methods={methods}
          onStatusChange={(status) => setRequest((current) => ({ ...current, status }))} />
      </> : <p className={styles.status} role="status">{activationFailed
        ? "We could not confirm this payment link. Retrying automatically…"
        : "Checking your payment link…"}</p>}
    </section>
  </main>;
}
