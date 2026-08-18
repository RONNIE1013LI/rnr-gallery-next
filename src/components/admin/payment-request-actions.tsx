"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./admin.module.css";

export function PaymentRequestActions({ requestId }: Readonly<{ requestId: string }>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [paymentUrl, setPaymentUrl] = useState("");

  async function mutate(action: "cancel" | "rotate_token") {
    if (!window.confirm(action === "cancel"
      ? "Cancel this payment request? It will no longer be payable."
      : "Rotate this payment link? The previous link will stop working.")) return;
    setPending(true);
    setMessage("");
    setPaymentUrl("");
    try {
      const response = await fetch(`/api/admin/payment-requests/${encodeURIComponent(requestId)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      });
      const payload = await response.json() as { error?: string; paymentUrl?: string };
      if (!response.ok) throw new Error(payload.error || "Payment request could not be updated");
      if (payload.paymentUrl) setPaymentUrl(payload.paymentUrl);
      setMessage(action === "cancel" ? "Payment request cancelled." : "Payment link rotated. Copy the new one-time link now.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Payment request could not be updated");
    } finally {
      setPending(false);
    }
  }

  return <div className={styles.actionStack}>
    <button disabled={pending} type="button" onClick={() => mutate("rotate_token")}>Rotate payment link</button>
    <button disabled={pending} type="button" onClick={() => mutate("cancel")}>Cancel payment request</button>
    {paymentUrl ? <div className={styles.oneTimeLink} role="status"><strong>New one-time link</strong><p>{paymentUrl}</p><button type="button" onClick={() => navigator.clipboard.writeText(paymentUrl)}>Copy payment link</button></div> : null}
    {message ? <p className={styles.formFeedback} role="status">{message}</p> : null}
  </div>;
}
