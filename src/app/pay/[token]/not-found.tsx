import Link from "next/link";
import styles from "@/components/payment-request.module.css";

export default function PaymentRequestNotFound() {
  return <main id="main-content" className={styles.page}>
    <section className={styles.card}>
      <p className={styles.eyebrow}>Secure payment</p>
      <h1>Payment request unavailable</h1>
      <p className={styles.status}>This link is invalid or no longer available. Please contact R&amp;R Gallery for an updated payment request.</p>
      <Link href="/contact">Contact R&amp;R Gallery</Link>
    </section>
  </main>;
}
