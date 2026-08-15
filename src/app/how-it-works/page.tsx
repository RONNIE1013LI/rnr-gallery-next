import Link from "next/link";
import styles from "@/components/storefront.module.css";
import { buildPublicMetadata } from "@/server/seo/metadata";

export const metadata = buildPublicMetadata({
  title: "How it works",
  description: "How R&R Gallery turns your photos and wording into approved personalised artwork.",
  path: "/how-it-works",
  image: "/media/home/homepage-begin-photo-help.webp",
  imageAlt: "Customer preparing photos for personalised artwork",
});

export default function HowItWorksPage() {
  return (
    <main id="main-content" className={styles.legalPage}>
      <article>
        <p className={styles.eyebrow}>The R&amp;R process</p>
        <h1>From source photo to finished artwork.</h1>
        <h2>1. Choose your product</h2>
        <p>Select the finished size, orientation and design options.</p>
        <h2>2. Send your photos and wording</h2>
        <p>Upload clear originals while ordering or send them afterwards.</p>
        <h2>3. Review the draft</h2>
        <p>Check every detail before approval. Your order includes up to two free design revisions, so it helps to send requested changes together.</p>
        <h2>4. Production and delivery</h2>
        <p>Standard production time is 5 business days from the date the order is placed.</p>
        <p>Estimated delivery times after production are:</p>
        <ul>
          <li>New Zealand: 2–3 business days.</li>
          <li>Australia Standard Delivery: approximately 5 business days.</li>
        </ul>
        <h2>Rush orders</h2>
        <p>If your order is urgent, choose the required date and confirm urgent service when that option is offered. Availability and the applicable fee are shown before the item is added to your cart.</p>
        <h2>Secure checkout</h2>
        <p>Card details are entered through Stripe&apos;s secure payment fields. Supported wallet options are shown when they are available on your browser and device.</p>
        <h2>Customer support</h2>
        <p>For help with photos, wording, timing or an existing order, contact R&amp;R Gallery by Messenger, phone or email.</p>
        <div className={styles.legalActions}>
          <Link className={styles.primaryButton} href="/shop">Start Your Design</Link>
          <a className={styles.secondaryButton} href="mailto:customerservice@rnrgallery.com">Contact Us</a>
        </div>
      </article>
    </main>
  );
}
