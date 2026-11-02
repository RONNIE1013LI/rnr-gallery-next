"use client";

import { useState } from "react";
import styles from "./admin.module.css";

export function ReturningCustomerVoucher({ customerKey }: Readonly<{ customerKey: string }>) {
  const [previousOrderNumber, setPreviousOrderNumber] = useState("");
  const [verified, setVerified] = useState(false);
  const [pending, setPending] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const eligible = /^[0-9]{5}$/.test(previousOrderNumber) && verified;

  async function generate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!eligible || pending) return;
    setPending(true); setError(""); setCode(""); setCopied(false);
    try {
      const response = await fetch(`/api/admin/customers/${encodeURIComponent(customerKey)}/voucher`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ previousOrderNumber, verified: true }),
      });
      const payload = await response.json() as { code?: string; error?: string };
      if (!response.ok || !payload.code) throw new Error(payload.error || "The voucher could not be generated.");
      setCode(payload.code);
    } catch (error) { setError(error instanceof Error ? error.message : "The voucher could not be generated."); }
    finally { setPending(false); }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(code); setCopied(true); }
    catch { setError("Copy was unavailable. Select and copy the voucher code below."); }
  }

  return <section className={styles.panel}>
    <h2>Returning customer voucher</h2>
    <p>Manually verify this customer’s previous 5-digit order, including offline orders. This voucher is bound to this registered account and can be redeemed once per account during the thank-you offer.</p>
    <p>20% off plus an extra 20% off the reduced merchandise and customisation price (36% total). Shipping and urgent fees are excluded. Generating again returns the same code; it does not reset redemption.</p>
    <form className={styles.formGrid} onSubmit={generate}>
      <label>Previous order number (5 digits)<input inputMode="numeric" pattern="[0-9]{5}" maxLength={5} required value={previousOrderNumber} onChange={(event) => { setPreviousOrderNumber(event.target.value); setVerified(false); }} /></label>
      <label className={`${styles.fullField} ${styles.checkboxField}`}><input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} /><span>I have verified that this previous order belongs to this customer.</span></label>
      <button type="submit" disabled={!eligible || pending}>{pending ? "Generating…" : "Generate voucher"}</button>
    </form>
    {code ? <div className={styles.formGrid}><label className={styles.fullField}>Voucher code<input readOnly value={code} onFocus={(event) => event.target.select()} /></label><button type="button" onClick={copy}>{copied ? "Copied" : "Copy voucher"}</button><p className={styles.mutedText}>No customer message has been sent.</p></div> : null}
    {error ? <p role="alert" className={styles.formFeedback}>{error}</p> : null}
  </section>;
}
