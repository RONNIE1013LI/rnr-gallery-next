import Link from "next/link";
import styles from "@/components/storefront.module.css";
import { buildPublicMetadata } from "@/server/seo/metadata";

export const metadata = buildPublicMetadata({
  title: "Cancellations & Refunds",
  description: "R&R Gallery cancellation and refund guidance for personalised orders before and after the initial design proof.",
  path: "/returns-refunds",
  image: "/media/home/homepage-canvas-finished.webp",
  imageAlt: "Finished personalised R&R Gallery artwork",
});

export default function ReturnsRefundsPage() {
  return (
    <main id="main-content" className={styles.legalPage}>
      <article>
        <p className={styles.eyebrow}>Order information</p>
        <h1>Cancellations and refunds</h1>
        <h2>Custom products and change-of-mind cancellation</h2>
        <p>
          This change-of-mind cancellation rule applies only to custom products.
          Orders can be cancelled for a full refund after successful checkout and
          before design work begins.
        </p>
        <p>
          Once the initial design proof has been delivered, the design fee is
          non-refundable.
        </p>
        <p>
          The remaining amount may be refunded and will generally equal 50% of the
          total order value.
        </p>
        <h2>Damaged delivery, faulty print, wrong item and approved-proof mismatch</h2>
        <p>
          If an item is damaged in delivery, faulty, the wrong item, or materially
          different from the approved proof, please contact us so we can assess the
          issue. This is not a change-of-mind cancellation.
        </p>
        <h2>Evidence and contact</h2>
        <p>
          Please provide your order details and reasonable evidence of the issue,
          such as photographs of the item, packaging or approved proof where relevant.
          We will consider the information and may ask reasonable follow-up questions.
        </p>
        <h2>Remedies and return shipping</h2>
        <p>
          Depending on the circumstances, an appropriate remedy may be a repair,
          reprint, replacement or refund. If an item is faulty or incorrect and a
          return is reasonably required, R&amp;R Gallery will meet reasonable return
          shipping costs.
        </p>
        <h2>Refund processing and statutory rights</h2>
        <p>
          We will process an approved refund using the appropriate payment method.
          The time it takes to appear depends on the payment provider and bank.
        </p>
        <p>
          Nothing in this page limits your rights for a faulty, damaged, wrong item
          or approved-proof mismatch, or any statutory remedy under the New Zealand
          Consumer Guarantees Act or Australian Consumer Law.
        </p>
        <div className={styles.legalActions}>
          <Link className={styles.primaryButton} href="/contact">Contact Us</Link>
          <Link className={styles.secondaryButton} href="/terms">Read Full Terms</Link>
        </div>
      </article>
    </main>
  );
}
