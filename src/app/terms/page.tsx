import type { Metadata } from "next";
import styles from "@/components/storefront.module.css";

export const metadata: Metadata = { title: "Terms of service" };

export default function TermsPage() {
  return (
    <main id="main-content" className={styles.legalPage}>
      <article>
        <p className={styles.eyebrow}>Legal</p>
        <h1>Terms of service</h1>
        <p>Last updated: 2 August 2026</p>
        <h2>Custom orders</h2>
        <p>
          Product dimensions are shown as width × height. Customers must provide
          source material they are authorised to use and check names, dates,
          wording, size and delivery details before approving a draft.
        </p>
        <h2>Drafts and revisions</h2>
        <p>
          Up to two revision rounds are included. Requested changes should be
          listed together. Further revision rounds may cost NZ$30. Changing to a
          different source photo after work begins may cost NZ$25; minor wording
          changes remain free unless otherwise agreed.
        </p>
        <h2>Deposits and cancellation</h2>
        <p>
          A deposit becomes non-refundable after a design or painting draft has
          been completed. This reflects the personalised work already performed
          and does not limit rights available under New Zealand consumer law.
        </p>
        <h2>Timing and urgent service</h2>
        <p>
          Standard production planning begins from five working days. Urgent
          service is offered only after R&amp;R Gallery confirms availability and the
          applicable urgent fee. Prompt customer replies are required to meet an
          agreed completion date.
        </p>
        <h2>Printing, colour and supplied files</h2>
        <p>
          Screen colour and printed colour can differ. Low-resolution or heavily
          compressed files may limit the result. We may enhance supplied photos
          for print quality unless the customer asks us to preserve the original
          look.
        </p>
        <h2>Contact</h2>
        <p>
          Questions should be sent to customerservice@rnrgallery.com or
          +64 21 023 48948 before ordering.
        </p>
      </article>
    </main>
  );
}
