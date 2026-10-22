import type { PayIdInstructions } from "@/server/payments/types";
import styles from "./storefront.module.css";
export function PayIdInstructionsPanel({ instructions }: { instructions: PayIdInstructions }) {
  return <section aria-label="AUD PayID bank transfer" className={styles.checkoutMessage}>
    <h2>PayID — AUD Bank Transfer</h2>
    <p>Your order is pending payment. Transfer the exact amount in AUD from your Australian bank.</p>
    <dl><dt>PayID email</dt><dd><strong>{instructions.payId}</strong></dd>
      <dt>Amount</dt><dd><strong>AUD {(instructions.amountCents / 100).toFixed(2)}</strong></dd>
      <dt>Payment reference</dt><dd><strong>{instructions.reference}</strong></dd></dl>
    <p>Enter this reference exactly. Missing or changed references and different amounts require manual review.</p>
    <p>Confirmation follows a bank statement check and may take several hours. Please do not pay twice.</p>
  </section>;
}
