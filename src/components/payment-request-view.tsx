"use client";

import { useEffect, useState } from "react";
import { formatMarketMoney } from "@/domain/money";
import type { PublicPaymentRequestDTO } from "@/server/payment-requests/types";
import type { PublicPaymentMethod } from "@/server/payments/payment-service";
import { PaymentRequestForm } from "./payment-request-form";
import styles from "./payment-request.module.css";

export function PaymentRequestView({ request: initialRequest, methods }: Readonly<{
  request: PublicPaymentRequestDTO;
  methods: readonly PublicPaymentMethod[];
}>) {
  const [request, setRequest] = useState(initialRequest);
  const [activated, setActivated] = useState(false);
  const [activationFailed, setActivationFailed] = useState(false);
  const [activationStopped, setActivationStopped] = useState(false);
  const [activationRetry, setActivationRetry] = useState(0);

  useEffect(() => {
    if (initialRequest.status === "paid" || initialRequest.status === "cancelled" || initialRequest.status === "invalidated") return;
    const match = window.location.pathname.match(/^\/pay\/([^/]+)\/?$/);
    if (!match) return;
    const endpoint = `/api/payment-requests/${encodeURIComponent(decodeURIComponent(match[1]))}`;
    let disposed = false;
    let opened = initialRequest.status !== "pending";
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    async function refresh() {
      controller = new AbortController();
      if (!opened) attempts++;
      let permanentFailure = false;
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(opened ? endpoint : `${endpoint}/open`, {
          method: opened ? "GET" : "POST",
          ...(!opened ? { headers: { "Content-Type": "application/json" }, body: "{}" } : {}),
          cache: "no-store", signal: controller.signal,
        });
        permanentFailure = response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429;
        const payload = await response.json() as { request?: PublicPaymentRequestDTO };
        if (!response.ok || !payload.request) throw new Error("Unavailable");
        if (disposed) return;
        const latest = payload.request;
        setRequest((current) => current.status === "paid" ? current : latest);
        setActivationFailed(false);
        opened = true;
        setActivated(true);
        if (latest.status === "paid" || latest.status === "cancelled" || latest.status === "invalidated") return;
      } catch {
        if (disposed) return;
        if (!opened) {
          setActivationFailed(true);
          if (permanentFailure || attempts >= 3) {
            setActivationStopped(true);
            return;
          }
        }
      } finally {
        clearTimeout(timeout);
      }
      if (!disposed) timer = setTimeout(refresh, 5000);
    }
    void refresh();
    return () => { disposed = true; controller?.abort(); clearTimeout(timer); };
  }, [initialRequest.status, activationRetry]);

  const paid = request.status === "paid";
  const expired = !paid && request.status !== "pending";
  const amount = formatMarketMoney(request.amountCents, request.currency);
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
        <a className={styles.payButton} href="/contact">Contact R&amp;R Gallery for a new payment link</a>
      </div> : activated ? <>
        <section className={styles.status} aria-label="Payment link validity">
          <p className={styles.formHint}>This payment link has no time limit.</p>
          <p className={styles.formHint}>You may share this link with a family member or friend if they are helping you complete the payment.</p>
        </section>
        <PaymentRequestForm amountCents={request.amountCents} currency={request.currency} methods={methods}
          onStatusChange={(status) => setRequest((current) => ({ ...current, status }))} />
      </> : activationStopped ? <div className={styles.status} role="status">
        <p>We could not confirm this payment link. Please try again or contact R&amp;R Gallery for help.</p>
        <button type="button" className={styles.payButton} onClick={() => {
          setActivationFailed(false);
          setActivationStopped(false);
          setActivationRetry((value) => value + 1);
        }}>Try again</button>
        <p><a href="/contact">Contact R&amp;R Gallery</a></p>
      </div> : <p className={styles.status} role="status">{activationFailed
        ? "We could not confirm this payment link. Retrying automatically…"
        : "Checking your payment link…"}</p>}
    </section>
  </main>;
}
