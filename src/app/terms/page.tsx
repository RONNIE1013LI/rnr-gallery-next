import type { Metadata } from "next";
import styles from "@/components/storefront.module.css";

export const metadata: Metadata = {
  title: "Terms of service",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <main id="main-content" className={styles.legalPage}>
      <article>
        <h1>Terms of service</h1>
        <p>Last updated: 21 August 2026</p>
        <nav className={styles.legalToc} aria-label="Terms contents">
          <strong>On this page</strong>
          <ul>
            <li><a href="#custom-orders">Custom orders</a></li>
            <li><a href="#drafts-and-revisions">Drafts and revisions</a></li>
            <li><a href="#cancellations-and-refunds">Cancellations and refunds</a></li>
            <li><a href="#timing-and-urgent-service">Timing and urgent service</a></li>
            <li><a href="#printing-and-files">Printing, colour and supplied files</a></li>
            <li><a href="#contact">Contact</a></li>
          </ul>
        </nav>
        <h2 id="custom-orders">Custom orders</h2>
        <p>
          Product dimensions are shown as width × height. Customers must provide
          source material they are authorised to use and check names, dates,
          wording, size and delivery details before approving a draft.
        </p>
        <h2 id="drafts-and-revisions">Drafts and revisions</h2>
        <p>
          Up to two revision rounds are included. Requested changes should be
          listed together. Further revision rounds may cost NZ$30. Changing to a
          different source photo after work begins may cost NZ$25; minor wording
          changes remain free unless otherwise agreed.
        </p>
        <h2 id="cancellations-and-refunds">Cancellations and refunds</h2>
        <p>
          Orders can be cancelled for a full refund after successful checkout and
          before design work begins. Once the initial design proof has been delivered,
          the design fee is non-refundable. The remaining amount may be refunded and
          will generally equal 50% of the total order value.
        </p>
        <h2 id="timing-and-urgent-service">Timing and urgent service</h2>
        <p>
          Please note that, by default, all orders have a production time of 5
          business days from the date the order is placed.
        </p>
        <p>Estimated delivery times after production are:</p>
        <p>
          <strong>New Zealand:</strong> 2–3 business days
        </p>
        <p>
          <strong>Australia:</strong> If you live in a major city on the east coast,
          DHL usually takes around 2 days for delivery, excluding the production
          time. The shipping cost is higher, but it is much faster.
        </p>
        <p>
          Standard delivery is more affordable and usually takes around 7–10 days.
        </p>
        <p>
          However, if you live in an area far from a major city, there may not be
          much difference between the two shipping options, as both can take around
          two weeks to arrive. This is because deliveries to remote areas usually
          require additional local transit time.
        </p>
        <p>
          If your order is <strong>urgent</strong>, please make sure to clearly let
          us know when placing your order so that we can arrange it accordingly
          and avoid any delays.
        </p>
        <h2 id="printing-and-files">Printing, colour and supplied files</h2>
        <p>
          Screen colour and printed colour can differ. Low-resolution or heavily
          compressed files may limit the result. We may enhance supplied photos
          for print quality unless the customer asks us to preserve the original
          look.
        </p>
        <h2 id="contact">Contact</h2>
        <p>
          Questions should be sent to customerservice@rnrgallery.com or
          +64 21 023 48948 before ordering.
        </p>
      </article>
    </main>
  );
}
