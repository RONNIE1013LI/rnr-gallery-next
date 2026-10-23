"use client";
import { useState } from "react";
import type { PayIdInstructions } from "@/server/payments/types";
import styles from "./storefront.module.css";
export function PayIdInstructionsPanel({ instructions }: { instructions: PayIdInstructions }) {
  const [message, setMessage] = useState("");
  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setMessage(`${label} copied`); }
    catch { setMessage("Copy unavailable. Please select and copy the displayed value."); }
  }
  return <section aria-label="AUD PayID bank transfer" className={styles.payidInstructions}>
    <h2>PayID — AUD Bank Transfer</h2>
    <p>Your order is pending payment. Transfer the exact amount in AUD from your Australian bank.</p>
    <dl><dt>PayID email</dt><dd><strong>{instructions.payId}</strong> <button className={styles.payidCopyButton} type="button" onClick={() => copy(instructions.payId, "PayID")}>Copy PayID</button></dd>
      <dt>Amount</dt><dd><strong>AUD {(instructions.amountCents / 100).toFixed(2)}</strong> <button className={styles.payidCopyButton} type="button" onClick={() => copy((instructions.amountCents / 100).toFixed(2), "Amount")}>Copy amount</button></dd>
      <dt>Payment reference</dt><dd><strong>{instructions.reference}</strong> <button className={styles.payidCopyButton} type="button" onClick={() => copy(instructions.reference, "Reference")}>Copy reference</button></dd></dl>
    <p role="status" aria-live="polite">{message}</p>
    <p>Transfer within 30 days and enter this reference exactly. Missing or changed references and different amounts require manual review.</p>
    <p>Confirmation follows a bank statement check and may take several hours. Please do not pay twice.</p>
  </section>;
}
