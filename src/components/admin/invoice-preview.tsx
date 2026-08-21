import Image from "next/image";
import type { MarketCurrency } from "@/domain/markets/types";
import { formatMarketMoney } from "@/domain/money";
import { invoiceCustomerAddressLines, invoiceDeliveryAddressLines } from "@/server/invoices/invoice-address-lines";
import type { InvoiceWorkspaceDraft, InvoiceWorkspaceTotals } from "./invoice-workspace";
import styles from "./admin.module.css";

export function InvoicePreview({
  invoiceNumber,
  draft,
  currency,
  gstRateBasisPoints,
  totals,
}: Readonly<{
  invoiceNumber: string;
  draft: InvoiceWorkspaceDraft;
  currency: MarketCurrency;
  gstRateBasisPoints: number;
  totals: InvoiceWorkspaceTotals;
}>) {
  const money = (cents: number) => formatMarketMoney(cents, currency);
  const customerAddress = invoiceCustomerAddressLines(draft).join("\n") || "—";
  const deliveryAddress = invoiceDeliveryAddressLines(draft).join("\n") || "—";
  return (
    <article className={styles.invoicePaper} aria-label="Invoice live preview">
      <header className={styles.invoicePaperHeader}>
        <Image src="/media/brand/rr-gallery-logo-2026.webp" alt="R&R Gallery" width={112} height={112} />
        <div><strong>{draft.businessName}</strong><span>{draft.businessAddress}</span>{draft.gstNumber ? <span>GST No: {draft.gstNumber}</span> : null}</div>
      </header>
      <div className={styles.invoicePaperAddresses}>
        <div><strong>Customer Address</strong><span>{customerAddress}</span></div>
        <div><strong>Deliver To</strong><span>{deliveryAddress}</span></div>
      </div>
      <section className={styles.invoicePaperMeta}>
        <h3>Tax Invoice # {invoiceNumber}</h3>
        <dl>
          <div><dt>Invoice Date:</dt><dd>{draft.invoiceDate}</dd></div>
          <div><dt>Customer:</dt><dd>{draft.customerName || "—"}</dd></div>
          <div><dt>Reference:</dt><dd>{draft.reference || "DRAFT"}</dd></div>
          <div><dt>Due Date:</dt><dd>{draft.dueDate}</dd></div>
        </dl>
      </section>
      <table className={styles.invoicePaperItems}>
        <thead><tr><th>Code</th><th>Description</th><th>Qty</th><th>Price</th><th>Amount</th></tr></thead>
        <tbody>{draft.items.map((item) => <tr key={item.key}><td>{item.code || "PRD"}</td><td>{item.description}</td><td>{item.quantityMilli / 1_000}</td><td>{money(item.rateInclGstCents)}</td><td>{money(Math.round(item.quantityMilli * item.rateInclGstCents / 1_000))}</td></tr>)}</tbody>
      </table>
      <div className={styles.invoicePaperBottom}>
        <div><strong>Payment to: {draft.bankAccount}</strong><p>{draft.notes}</p><small>{draft.terms}</small></div>
        <dl>
          <div><dt>Sub Total</dt><dd>{money(totals.subtotalExGstCents)}</dd></div>
          {gstRateBasisPoints > 0 ? <div><dt>GST {gstRateBasisPoints / 100}%</dt><dd>{money(totals.gstCents)}</dd></div> : null}
          {draft.discountCents > 0 ? <div><dt>Discount</dt><dd>−{money(draft.discountCents)}</dd></div> : null}
          <div><dt>Total</dt><dd>{money(totals.totalInclGstCents)}</dd></div>
        </dl>
      </div>
      <footer>{[draft.businessPhone, draft.businessEmail, draft.businessWebsite].filter(Boolean).join(" | ")}</footer>
    </article>
  );
}
