"use client";

import { useEffect, useState } from "react";
import { ReturningCustomerVoucher } from "@/components/admin/returning-customer-voucher";
import styles from "@/components/admin/admin.module.css";

type OrderVoucherContext = {
  jobId: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  customerKey: string | null;
  expectedUpdatedAt: string;
  canIssue: boolean;
  message?: string;
};

export function OrderVoucherPanel({ jobId }: Readonly<{ jobId: string }>) {
  const [result, setResult] = useState<{ jobId: string; context?: OrderVoucherContext; error?: string } | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/forms/jobs/${encodeURIComponent(jobId)}/voucher`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as OrderVoucherContext & { error?: string };
        if (!response.ok) throw new Error(payload.error || "The saved order could not be loaded.");
        if (active) setResult({ jobId, context: payload });
      } catch (error) {
        if (active) setResult({ jobId, error: error instanceof Error ? error.message : "The saved order could not be loaded." });
      }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [jobId]);

  const current = result?.jobId === jobId ? result : null;
  const context = current?.context;
  return <div data-voucher-controls aria-live="polite">
    {!current ? <p className={styles.mutedText}>Loading saved order…</p> : null}
    {current?.error ? <p role="alert" className={styles.formFeedback}>{current.error}</p> : null}
    {context ? <>
      <p>Saved customer: <strong>{context.customerName}</strong> · <span>{context.customerEmail}</span></p>
      {context.canIssue && context.customerKey ? <ReturningCustomerVoucher key={`${jobId}:${context.expectedUpdatedAt}`} customerKey={context.customerKey} savedOrder={{ jobId, orderNumber: context.orderNumber, expectedUpdatedAt: context.expectedUpdatedAt }} /> : <p className={styles.formFeedback}>{context.message || "This saved customer is not eligible for a voucher."}</p>}
    </> : null}
  </div>;
}
