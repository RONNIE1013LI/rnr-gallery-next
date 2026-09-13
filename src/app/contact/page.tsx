import { ContactQuote } from "@/components/contact-quote";
import styles from "@/components/storefront.module.css";
import { buildPublicMetadata } from "@/server/seo/metadata";

export const metadata = buildPublicMetadata({
  title: "Contact R&R Gallery",
  description: "Ask R&R Gallery a question or request a custom artwork quote online, with optional photos. Phone, email, Messenger and WhatsApp are also available.",
  path: "/contact",
  image: "/media/home/homepage-begin-photo-help.webp",
  imageAlt: "R&R Gallery customer photo and artwork support",
});

export default function ContactPage() {
  return (
    <main id="main-content" className={styles.legalPage}>
      <article>
        <p className={styles.eyebrow}>Contact</p>
        <h1>Talk to R&amp;R Gallery.</h1>
        <ContactQuote />
        <h2>Other ways to contact us</h2>
        <address>
          R&amp;R Gallery Ltd<br />
          Fairview Heights, Auckland, New Zealand<br />
          Pickup available by appointment.<br />
          <a href="tel:+642102348948">+64 21 023 48948</a><br />
          <a href="mailto:customerservice@rnrgallery.com">customerservice@rnrgallery.com</a>
        </address>
        <p>Need help choosing? Send your photos, occasion, preferred size and the date you need it. We can help you choose the next step.</p>
        <div className={styles.legalActions}>
          <a className={styles.secondaryButton} href="https://m.me/RandRgallery" rel="noopener noreferrer">Messenger</a>
          <a className={styles.secondaryButton} href="https://wa.me/642102348948" rel="noopener noreferrer">WhatsApp</a>
        </div>
      </article>
    </main>
  );
}
