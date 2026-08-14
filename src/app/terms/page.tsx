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
        <p>Last updated: 2 August 2026</p>
        <nav className={styles.legalToc} aria-label="Terms contents">
          <strong>On this page</strong>
          <ul>
            <li><a href="#custom-orders">Custom orders</a></li>
            <li><a href="#drafts-and-revisions">Drafts and revisions</a></li>
            <li><a href="#deposits-and-cancellation">Deposits and cancellation</a></li>
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
        <h2 id="deposits-and-cancellation">Deposits and cancellation</h2>
        <p>
          A deposit becomes non-refundable after a design or painting draft has
          been completed. This reflects the personalised work already performed
          and does not limit rights available under New Zealand consumer law.
        </p>
        <h2 id="timing-and-urgent-service">Timing and urgent service</h2>
        <p>
          Please note that, by default, all orders have a production time of 5
          business days from the date the order is placed.
        </p>
        <p>Estimated delivery times after production are:</p>
        <p>
          <strong>New Zealand:</strong> 2–3 business days
          <br />
          <strong>Australia (Standard Delivery):</strong> approximately 5 business
          days
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
