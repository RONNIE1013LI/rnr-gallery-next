import type { Metadata } from "next";
import styles from "@/components/storefront.module.css";

export const metadata: Metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return (
    <main id="main-content" className={styles.legalPage}>
      <article>
        <p className={styles.eyebrow}>Legal</p>
        <h1>Privacy policy</h1>
        <p>Last updated: 2 August 2026</p>
        <h2>Who we are</h2>
        <p>
          R&amp;R Gallery Ltd provides custom canvas, banner and print services in
          New Zealand. Our business address is 11 Para Close, Fairview Heights,
          Auckland 0632, New Zealand.
        </p>
        <h2>Information we collect</h2>
        <p>
          We may collect your contact, billing, delivery and order information;
          photos and wording supplied for artwork; messages, draft feedback and
          approvals; payment status; and technical information needed to operate
          and secure the service.
        </p>
        <h2>How we use information</h2>
        <ul>
          <li>To quote, create, review, produce and deliver your order.</li>
          <li>To process payments and prevent misuse or fraud.</li>
          <li>To provide customer support and required service notices.</li>
          <li>To meet accounting, tax and other legal obligations.</li>
        </ul>
        <h2>Photos and artwork</h2>
        <p>
          Customer files are used to prepare the requested design and print. We
          may enhance supplied photos to improve print quality. We do not use
          private customer artwork for unrelated advertising without permission.
        </p>
        <h2>Service providers and retention</h2>
        <p>
          We share only the information needed with providers supporting hosting,
          payments, delivery, communications and production. We keep information
          only as long as reasonably required for the order, support, security and
          legal records.
        </p>
        <h2>Your choices</h2>
        <p>
          You may ask to access or correct your personal information, or raise a
          privacy concern. Some records must be retained where required by law.
        </p>
        <h2>Contact</h2>
        <p>
          Contact our Privacy Officer at customerservice@rnrgallery.com or
          +64 21 023 48948.
        </p>
      </article>
    </main>
  );
}
