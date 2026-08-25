import Link from "next/link";
import styles from "@/components/storefront.module.css";
import { deliveryCopy } from "@/domain/content/delivery-copy";
import { buildPublicMetadata } from "@/server/seo/metadata";

export const metadata = buildPublicMetadata({
  title: "Shipping & Delivery",
  description: "Confirmed R&R Gallery production and estimated delivery times for personalised orders in New Zealand and Australia.",
  path: "/shipping-delivery",
  image: "/media/home/homepage-canvas-finished.webp",
  imageAlt: "Finished personalised artwork ready for delivery",
});

export default function ShippingDeliveryPage() {
  return (
    <main id="main-content" className={styles.legalPage}>
      <article>
        <p className={styles.eyebrow}>Shipping &amp; delivery</p>
        <h1>Production and delivery timing.</h1>
        <h2>Production</h2>
        <p>{deliveryCopy.production}</p>
        <h2>Estimated delivery after production</h2>
        <ul>
          <li>{deliveryCopy.newZealand}</li>
        </ul>
        <p>{deliveryCopy.australiaDhl}</p>
        <p>{deliveryCopy.australiaStandard}</p>
        <p>{deliveryCopy.australiaRemote}</p>
        <p>Checkout shows the available delivery options and prices for the address entered.</p>
        <p>Your personalised artwork is sent to production after the proof is approved. Two revision rounds are included.</p>
        <div className={styles.legalActions}>
          <Link className={styles.primaryButton} href="/shop">Start Your Order</Link>
          <Link className={styles.secondaryButton} href="/contact">Ask a Question</Link>
        </div>
      </article>
    </main>
  );
}
