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
        <p>
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
        <div className={styles.legalActions}>
          <Link className={styles.primaryButton} href="/contact">Contact Us</Link>
          <Link className={styles.secondaryButton} href="/terms">Read Full Terms</Link>
        </div>
      </article>
    </main>
  );
}
