"use client";

import { FormEvent, useState } from "react";
import type { OrderFulfilmentStatus } from "@/server/db/schema/orders";
import { getAllowedOrderStatusTransitions } from "@/server/admin/order-admin-service";
import { createClientId } from "@/lib/client-id";
import styles from "./admin.module.css";

type Props = Readonly<{
  orderId: string;
  currentStatus: OrderFulfilmentStatus;
  tracking: Readonly<{
    carrier: string | null;
    number: string | null;
    url: string | null;
  }>;
}>;

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function AdminOrderActions({ orderId, currentStatus, tracking }: Props) {
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const allowedStatuses = getAllowedOrderStatusTransitions(currentStatus);

  async function mutate(payload: Record<string, unknown>) {
    setPending(true);
    setFeedback("");
    try {
      const response = await fetch(`/api/admin/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          idempotencyKey: createClientId(),
        }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error || "The order could not be updated.");
      setFeedback("Saved. Refreshing order details…");
      window.location.reload();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "The order could not be updated.");
      setPending(false);
    }
  }

  function submitStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const toStatus = String(form.get("toStatus"));
    if (toStatus === "cancelled" && !window.confirm(
      "Cancel this order? This records an operational cancellation but does not refund the payment provider.",
    )) return;
    void mutate({
      action: "change_status",
      toStatus,
      reason: String(form.get("reason") ?? ""),
      ...(toStatus === "cancelled" ? { confirmed: true } : {}),
    });
  }

  function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void mutate({
      action: "add_note",
      visibility: String(form.get("visibility")),
      body: String(form.get("body") ?? ""),
    });
  }

  function submitTracking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void mutate({
      action: "set_tracking",
      carrier: String(form.get("carrier") ?? ""),
      trackingNumber: String(form.get("trackingNumber") ?? ""),
      trackingUrl: String(form.get("trackingUrl") ?? "") || undefined,
    });
  }

  return (
    <div className={styles.actionStack}>
      <section className={styles.panel}>
        <h2>Update order status</h2>
        {allowedStatuses.length ? <form className={styles.compactForm} onSubmit={submitStatus}>
          <label>
            <span>Next status</span>
            <select name="toStatus" defaultValue="" required disabled={pending}>
              <option value="" disabled>Select status</option>
              {allowedStatuses.map((status) => <option key={status} value={status}>{label(status)}</option>)}
            </select>
          </label>
          <label>
            <span>Reason (optional)</span>
            <input name="reason" maxLength={500} disabled={pending} />
          </label>
          <button type="submit" disabled={pending}>Update status</button>
        </form> : <p className={styles.mutedText}>This order is in a terminal status and has no further workflow transitions.</p>}
      </section>

      <section className={styles.panel}>
        <h2>Add note</h2>
        <form className={styles.compactForm} onSubmit={submitNote}>
          <label>
            <span>Visibility</span>
            <select name="visibility" defaultValue="internal" disabled={pending}>
              <option value="internal">Internal only</option>
              <option value="customer">Customer visible</option>
            </select>
          </label>
          <label>
            <span>Note</span>
            <textarea name="body" rows={4} maxLength={2000} required disabled={pending} />
          </label>
          <button type="submit" disabled={pending}>Add note</button>
        </form>
      </section>

      <section className={styles.panel}>
        <h2>Tracking</h2>
        <form className={styles.compactForm} onSubmit={submitTracking}>
          <label>
            <span>Carrier</span>
            <input name="carrier" defaultValue={tracking.carrier ?? ""} required disabled={pending} />
          </label>
          <label>
            <span>Tracking number</span>
            <input name="trackingNumber" defaultValue={tracking.number ?? ""} required disabled={pending} />
          </label>
          <label>
            <span>Tracking URL (HTTPS)</span>
            <input name="trackingUrl" type="url" defaultValue={tracking.url ?? ""} disabled={pending} />
          </label>
          <button type="submit" disabled={pending}>Save tracking</button>
        </form>
      </section>

      <p className={styles.formFeedback} aria-live="polite">{feedback}</p>
    </div>
  );
}
