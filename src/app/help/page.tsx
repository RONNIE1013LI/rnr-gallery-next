import Link from "next/link";
import styles from "@/components/storefront.module.css";
import { buildPublicMetadata } from "@/server/seo/metadata";

export const metadata = buildPublicMetadata({
  title: "Custom Artwork Help",
  description: "Get help choosing photos, sending files, reviewing proofs and ordering personalised canvas and banners from R&R Gallery.",
  path: "/help",
  image: "/media/home/homepage-begin-photo-help.webp",
  imageAlt: "Help preparing photos for personalised artwork",
});

export default function HelpPage() {
  return (
    <main id="main-content" className={styles.legalPage}>
      <article>
        <p className={styles.eyebrow}>Help</p>
        <h1>Help with your custom order.</h1>
        <h2>Do I need to upload photos while ordering?</h2>
        <p>No. Choose Upload Photos Now or Send Photos After Ordering. Photos sent later can be provided by Messenger, Email or WhatsApp.</p>
        <h2>Will I see the artwork before it is printed?</h2>
        <p>Yes. Personalised orders include a proof before printing and two revision rounds.</p>
        <h2>How long does production take?</h2>
        <p>Standard production time is 5 business days from the date the order is placed.</p>
        <h2>Where do you deliver?</h2>
        <p>R&amp;R Gallery offers delivery within New Zealand and to Australia. See current estimated delivery times on the shipping page.</p>
        <div className={styles.legalActions}>
          <Link className={styles.primaryButton} href="/how-it-works">How It Works</Link>
          <Link className={styles.secondaryButton} href="/contact">Contact Us</Link>
        </div>
      </article>
    </main>
  );
}
