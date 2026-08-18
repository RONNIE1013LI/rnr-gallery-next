"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { formatMarketMoney } from "@/domain/money";
import type { AdminOrderPaymentSummaryDTO } from "@/server/payment-requests/types";
import styles from "./admin.module.css";

function nextKey() {
  return window.crypto?.randomUUID?.() ??
    `ledger-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function entryLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function PaymentLedgerPanel({ summary }: Readonly<{ summary: AdminOrderPaymentSummaryDTO }>) {
  const router = useRouter();
  const money = (cents: number) => formatMarketMoney(cents, summary.currency);
  const [amount, setAmount] = useState(0);
  const [receivedAt, setReceivedAt] = useState("");
  const [reference, setReference] = useState("");
  const [payerName, setPayerName] = useState("");
  const [note, setNote] = useState("");
  const [reversing, setReversing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function post(body: unknown) {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/orders/${encodeURIComponent(summary.orderId)}/ledger`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Ledger entry could not be recorded");
      setMessage("Payment ledger updated.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ledger entry could not be recorded");
    } finally {
      setPending(false);
    }
  }

  async function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await post({
      action: "bank_transfer",
      amountCents: Math.round(Number(amount) * 100),
      receivedAt: new Date(receivedAt).toISOString(),
      ...(reference.trim() ? { reference } : {}),
      ...(payerName.trim() ? { payerName } : {}),
      ...(note.trim() ? { note } : {}),
      idempotencyKey: nextKey(),
    });
  }

  const reversed = new Set(summary.ledger.flatMap((entry) => entry.reversesEntryId ? [entry.reversesEntryId] : []));
  return <section className={styles.panel}>
    <div className={styles.panelHeading}><h2>Order payment balance</h2>{summary.unreservedCents > 0 ? <a href={`/admin/payment-requests/new?orderId=${encodeURIComponent(summary.orderId)}`}>Create payment request</a> : null}</div>
    <div className={styles.paymentBalanceGrid}>
      <div><span>Order total</span><strong>{money(summary.totalCents)}</strong></div>
      <div><span>Net paid</span><strong>{money(summary.netPaidCents)}</strong></div>
      <div><span>Outstanding</span><strong>{money(summary.outstandingCents)}</strong></div>
      <div><span>Reserved</span><strong>{money(summary.reservedCents)}</strong></div>
    </div>
    <p className={styles.safetyNotice}>Available for a new fixed request: {money(summary.unreservedCents)}. Provider sessions recheck this balance.</p>
    <div className={styles.paymentLedgerList}>
      {summary.ledger.length ? summary.ledger.map((entry) => <article key={entry.id}>
        <div><strong>{entryLabel(entry.entryType)}</strong><span>{entry.direction === "credit" ? "+" : "−"}{money(entry.amountCents)}</span></div>
        <small>{new Intl.DateTimeFormat("en-NZ", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.receivedAt))}{entry.reference ? ` · ${entry.reference}` : ""}</small>
        {entry.entryType === "bank_transfer" && !reversed.has(entry.id) ? <button type="button" onClick={() => { setReversing(entry.id); setReason(""); }}>Reverse bank transfer</button> : null}
        {reversing === entry.id ? <div className={styles.reversalForm}>
          <label><span>Reversal reason</span><input aria-label="Reversal reason" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <button disabled={pending || !reason.trim()} type="button" onClick={() => post({ action: "reverse", entryId: entry.id, reason, idempotencyKey: nextKey() })}>Confirm reversal</button>
        </div> : null}
      </article>) : <p>No ledger entries recorded.</p>}
    </div>
    <form className={styles.paymentLedgerForm} onSubmit={record}>
      <h3>Record bank transfer</h3>
      <label><span>Amount</span><input aria-label="Bank transfer amount" min="0.01" required step="0.01" type="number" value={amount} onChange={(event) => setAmount(Number(event.target.value))} /></label>
      <label><span>Received at</span><input aria-label="Received at" required type="datetime-local" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} /></label>
      <label><span>Reference (optional)</span><input value={reference} onChange={(event) => setReference(event.target.value)} /></label>
      <label><span>Payer name (optional)</span><input value={payerName} onChange={(event) => setPayerName(event.target.value)} /></label>
      <label className={styles.paymentRequestWideField}><span>Note (optional)</span><input value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <button disabled={pending} type="submit">Record bank transfer</button>
    </form>
    {message ? <p className={styles.formFeedback} role="status">{message}</p> : null}
  </section>;
}
