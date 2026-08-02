import type { Metadata } from "next";
import styles from "@/components/storefront.module.css";

export const metadata: Metadata = { title: "How it works" };

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
        <p>Check every detail and request changes before giving approval.</p>
        <h2>4. Production and delivery</h2>
        <p>Your approved artwork moves into production and is prepared for pickup or post.</p>
      </article>
    </main>
  );
}
