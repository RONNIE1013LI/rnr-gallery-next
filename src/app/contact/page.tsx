import styles from "@/components/storefront.module.css";
import { buildPublicMetadata } from "@/server/seo/metadata";

export const metadata = buildPublicMetadata({
  title: "Contact R&R Gallery",
  description: "Contact R&R Gallery in Auckland by phone, email, Messenger or WhatsApp for help with custom artwork and orders.",
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
        <h2>Customer support</h2>
        <address>
          R&amp;R Gallery Ltd<br />
          11 Para Close<br />
          Fairview Heights<br />
          Auckland 0632<br />
          New Zealand<br />
          <a href="tel:+642102348948">+64 21 023 48948</a><br />
          <a href="mailto:customerservice@rnrgallery.com">customerservice@rnrgallery.com</a>
        </address>
        <p>Send questions or order photos through the channel that suits you.</p>
        <div className={styles.legalActions}>
          <a className={styles.primaryButton} href="https://m.me/RandRgallery" rel="noopener noreferrer">Messenger</a>
          <a className={styles.secondaryButton} href="https://wa.me/642102348948" rel="noopener noreferrer">WhatsApp</a>
        </div>
      </article>
    </main>
  );
}
