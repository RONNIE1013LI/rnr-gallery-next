import styles from "./storefront.module.css";

const assurances = [
  "Proof before printing",
  "Two revisions included",
  "Designed in New Zealand",
  "Secure checkout",
  "NZ & AU delivery",
] as const;

export function PurchaseTrustStrip() {
  return (
    <ul className={styles.purchaseTrustStrip} aria-label="Purchase assurances">
      {assurances.map((assurance) => <li key={assurance}>{assurance}</li>)}
    </ul>
  );
}
