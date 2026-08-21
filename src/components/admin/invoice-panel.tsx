"use client";

import { useEffect, useMemo, useState } from "react";
import { createClientId } from "@/lib/client-id";
import type { MarketCurrency } from "@/domain/markets/types";
import { formatMarketMoney } from "@/domain/money";
import { InvoicePreview } from "./invoice-preview";
import { MoneyCentsInput } from "./money-cents-input";
import styles from "./admin.module.css";

type InvoiceItem = Readonly<{
  position: number;
  code: string;
  description: string;
  quantityMilli: number;
  rateInclGstCents: number;
  lineTotalInclGstCents: number;
}>;

type Invoice = Readonly<{
  id: string;
  jobId: string;
  invoiceNumber: string;
  status: "draft" | "issued" | "void";
  invoiceDate: string;
  dueDate: string;
  reference: string;
  webOrderNumber: string;
  businessName: string;
  businessAddress: string;
  businessEmail: string;
  businessPhone: string;
  businessWebsite: string;
  gstNumber: string;
  bankAccount: string;
  customerName: string;
  customerEmail: string;
  customerAddress: string;
  deliveryAddress: string;
  currency: MarketCurrency;
  gstRateBasisPoints: number;
  grossCents: number;
  discountCents: number;
  subtotalExGstCents: number;
  gstCents: number;
  totalInclGstCents: number;
  notes: string;
  terms: string;
  issuedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  updatedAt: string;
  items: readonly InvoiceItem[];
}>;

type EditableItem = Omit<InvoiceItem, "lineTotalInclGstCents"> & { key: string };
type Draft = Readonly<{
  invoiceDate: string;
  dueDate: string;
  reference: string;
  businessName: string;
  businessAddress: string;
  businessEmail: string;
  businessPhone: string;
  businessWebsite: string;
  gstNumber: string;
  bankAccount: string;
  customerName: string;
  customerEmail: string;
  customerAddress: string;
  deliveryAddress: string;
  discountCents: number;
  notes: string;
  terms: string;
  items: readonly EditableItem[];
}>;

function editable(invoice: Invoice): Draft {
  return {
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    reference: invoice.reference,
    businessName: invoice.businessName,
    businessAddress: invoice.businessAddress,
    businessEmail: invoice.businessEmail,
    businessPhone: invoice.businessPhone,
    businessWebsite: invoice.businessWebsite,
    gstNumber: invoice.gstNumber,
    bankAccount: invoice.bankAccount,
    customerName: invoice.customerName,
    customerEmail: invoice.customerEmail,
    customerAddress: invoice.customerAddress,
    deliveryAddress: invoice.deliveryAddress,
    discountCents: invoice.discountCents,
    notes: invoice.notes,
    terms: invoice.terms,
    items: invoice.items.map((item) => ({
      ...item,
      key: `${item.position}-${item.code}-${item.description}`,
    })),
  };
}

function sameFinancialDraft(invoice: Invoice, draft: Draft) {
  return invoice.discountCents === draft.discountCents &&
    invoice.items.length === draft.items.length &&
    invoice.items.every((item, index) =>
      item.quantityMilli === draft.items[index]?.quantityMilli &&
      item.rateInclGstCents === draft.items[index]?.rateInclGstCents,
    );
}

function totals(draft: Draft, invoice: Invoice) {
  if (sameFinancialDraft(invoice, draft)) {
    return {
      grossCents: invoice.grossCents,
      discountCents: draft.discountCents,
      subtotalExGstCents: invoice.subtotalExGstCents,
      gstCents: invoice.gstCents,
      totalInclGstCents: invoice.totalInclGstCents,
    };
  }
  const grossCents = draft.items.reduce(
    (sum, item) => sum + Math.round(item.quantityMilli * item.rateInclGstCents / 1_000),
    0,
  );
  const totalInclGstCents = Math.max(0, grossCents - draft.discountCents);
  const gstCents = Math.round(
    totalInclGstCents * invoice.gstRateBasisPoints /
    (10_000 + invoice.gstRateBasisPoints),
  );
  return {
    grossCents,
    discountCents: draft.discountCents,
    subtotalExGstCents: totalInclGstCents - gstCents,
    gstCents,
    totalInclGstCents,
  };
}

function requestDraft(draft: Draft) {
  return {
    ...draft,
    items: draft.items.map((item) => ({
      code: item.code,
      description: item.description,
      quantityMilli: item.quantityMilli,
      rateInclGstCents: item.rateInclGstCents,
    })),
  };
}

export function InvoicePanel({
  jobId,
  jobApiBase = "/api/admin/jobs",
  invoicePdfBase = "/api/admin/invoices",
  canEdit = true,
  downloadAtTop = false,
}: Readonly<{
  jobId: string;
  jobApiBase?: string;
  invoicePdfBase?: string;
  canEdit?: boolean;
  downloadAtTop?: boolean;
}>) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const money = (cents: number) => invoice
    ? formatMarketMoney(cents, invoice.currency)
    : "";

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${jobApiBase}/${jobId}/invoice`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    }).then(async (response) => {
      const body = await response.json().catch(() => null) as { invoice?: Invoice; error?: string } | null;
      if (!response.ok || !body?.invoice) throw new Error(body?.error || "The invoice could not be loaded.");
      setInvoice(body.invoice);
      setDraft(editable(body.invoice));
    }).catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFeedback(error instanceof Error ? error.message : "The invoice could not be loaded.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [jobId, jobApiBase]);

  const calculated = useMemo(() => draft && invoice ? totals(draft, invoice) : null, [draft, invoice]);
  const locked = !canEdit || invoice?.status !== "draft" || pending;

  function updateField<K extends keyof Omit<Draft, "items">>(key: K, value: Draft[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  }

  function updateItem(key: string, patch: Partial<EditableItem>) {
    setDraft((current) => current ? {
      ...current,
      items: current.items.map((item) => item.key === key ? { ...item, ...patch } : item),
    } : current);
  }

  async function mutate(method: "PUT" | "POST", body: Record<string, unknown>) {
    setPending(true);
    setFeedback("");
    try {
      const response = await fetch(`${jobApiBase}/${jobId}/invoice`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null) as { invoice?: Invoice; error?: string } | null;
      if (!response.ok || !result?.invoice) throw new Error(result?.error || "The invoice could not be saved.");
      setInvoice(result.invoice);
      setDraft(editable(result.invoice));
      setFeedback(method === "PUT" ? "Draft saved." : result.invoice.status === "issued" ? "Invoice issued." : "Invoice voided.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "The invoice could not be saved.");
    } finally {
      setPending(false);
    }
  }

  function saveDraft() {
    if (!invoice || !draft) return;
    void mutate("PUT", {
      invoiceId: invoice.id,
      idempotencyKey: createClientId(),
      expectedUpdatedAt: invoice.updatedAt,
      draft: requestDraft(draft),
    });
  }

  function issueInvoice() {
    if (!invoice || !window.confirm("Issue this invoice? Issued invoice details cannot be edited.")) return;
    void mutate("POST", {
      action: "issue",
      invoiceId: invoice.id,
      idempotencyKey: createClientId(),
      expectedUpdatedAt: invoice.updatedAt,
    });
  }

  function voidInvoice() {
    if (!invoice || voidReason.trim().length < 3) {
      setFeedback("Enter a reason before voiding the invoice.");
      return;
    }
    void mutate("POST", {
      action: "void",
      invoiceId: invoice.id,
      idempotencyKey: createClientId(),
      expectedUpdatedAt: invoice.updatedAt,
      reason: voidReason,
    });
  }

  if (loading) return <section className={styles.panel}><h2>Invoice</h2><p className={styles.mutedText}>Loading invoice…</p></section>;
  if (!invoice || !draft || !calculated) return <section className={styles.panel}><h2>Invoice</h2><p className={styles.formFeedback} role="alert">{feedback || "The invoice could not be loaded."}</p></section>;

  return (
    <section className={`${styles.panel} ${styles.invoicePanel}`}>
      <div className={styles.persistedInvoiceWorkspace}>
        <div className={styles.persistedInvoiceEditor}>
      <div className={styles.panelHeading}>
        <div><h2>Invoice</h2><strong>{invoice.invoiceNumber}</strong></div>
        <span className={styles.invoiceStatus} data-status={invoice.status}>{invoice.status === "draft" ? "Draft" : invoice.status === "issued" ? "Issued" : "Void"}</span>
      </div>
      <p className={styles.mutedText}>Persistent GST invoice · prices include GST · all changes are recorded in the audit log.</p>
      {downloadAtTop ? <div className={styles.invoicePrimaryActions}>
        <a className={styles.secondaryAdminButton} href={`${invoicePdfBase}/${invoice.id}/pdf`}>Download PDF</a>
      </div> : null}

      <div className={styles.invoiceMetaGrid}>
        <label><span>Invoice date</span><input type="date" value={draft.invoiceDate} onChange={(event) => updateField("invoiceDate", event.target.value)} disabled={locked} /></label>
        <label><span>Due date</span><input type="date" value={draft.dueDate} onChange={(event) => updateField("dueDate", event.target.value)} disabled={locked} /></label>
        <label><span>Reference</span><input value={draft.reference} maxLength={190} onChange={(event) => updateField("reference", event.target.value)} disabled={locked} /></label>
        <label><span>Web order number</span><input value={invoice.webOrderNumber} readOnly /></label>
      </div>

      <div className={styles.invoiceAddressGrid}>
        <fieldset><legend>From</legend><label><span>Business name</span><input value={draft.businessName} onChange={(event) => updateField("businessName", event.target.value)} disabled={locked} /></label><label><span>Business address</span><textarea rows={4} value={draft.businessAddress} onChange={(event) => updateField("businessAddress", event.target.value)} disabled={locked} /></label><label><span>Business email</span><input type="email" value={draft.businessEmail} onChange={(event) => updateField("businessEmail", event.target.value)} disabled={locked} /></label><label><span>Business phone</span><input value={draft.businessPhone} onChange={(event) => updateField("businessPhone", event.target.value)} disabled={locked} /></label><label><span>Website</span><input value={draft.businessWebsite} onChange={(event) => updateField("businessWebsite", event.target.value)} disabled={locked} /></label><label><span>GST number</span><input value={draft.gstNumber} onChange={(event) => updateField("gstNumber", event.target.value)} disabled={locked} /></label><label><span>Bank account</span><input value={draft.bankAccount} onChange={(event) => updateField("bankAccount", event.target.value)} disabled={locked} /></label></fieldset>
        <fieldset><legend>Customer</legend><label><span>Name</span><input value={draft.customerName} onChange={(event) => updateField("customerName", event.target.value)} disabled={locked} /></label><label><span>Email</span><input type="email" value={draft.customerEmail} onChange={(event) => updateField("customerEmail", event.target.value)} disabled={locked} /></label><label><span>Customer address</span><textarea rows={4} value={draft.customerAddress} onChange={(event) => updateField("customerAddress", event.target.value)} disabled={locked} /></label></fieldset>
        <fieldset><legend>Delivery</legend><label><span>Delivery address</span><textarea rows={8} value={draft.deliveryAddress} onChange={(event) => updateField("deliveryAddress", event.target.value)} disabled={locked} /></label></fieldset>
      </div>

      <div className={styles.invoiceItemsHeading}><h3>Line items</h3>{invoice.status === "draft" && canEdit ? <button type="button" className={styles.secondaryAdminButton} disabled={pending || draft.items.length >= 100} onClick={() => setDraft((current) => current ? { ...current, items: [...current.items, { key: createClientId(), position: current.items.length, code: "", description: "Order item", quantityMilli: 1_000, rateInclGstCents: 0 }] } : current)}>Add item</button> : null}</div>
      <div className={styles.invoiceItems}>
        {draft.items.map((item, index) => <fieldset key={item.key} className={styles.invoiceItem}>
          <legend>Item {index + 1}</legend>
          <label><span>Code</span><input aria-label={`Item ${index + 1} code`} value={item.code} onChange={(event) => updateItem(item.key, { code: event.target.value })} disabled={locked} /></label>
          <label className={styles.invoiceDescription}><span>Description</span><textarea aria-label={`Item ${index + 1} description`} rows={2} value={item.description} onChange={(event) => updateItem(item.key, { description: event.target.value })} disabled={locked} /></label>
          <label><span>Quantity</span><input aria-label={`Item ${index + 1} quantity`} type="number" min="0.001" step="0.001" value={item.quantityMilli / 1_000} onChange={(event) => updateItem(item.key, { quantityMilli: Math.max(1, Math.round(Number(event.target.value) * 1_000)) })} disabled={locked} /></label>
          <label><span>Rate incl GST</span><MoneyCentsInput ariaLabel={`Item ${index + 1} rate incl GST`} cents={item.rateInclGstCents} onCentsChange={(rateInclGstCents) => updateItem(item.key, { rateInclGstCents })} disabled={locked} /></label>
          {invoice.status === "draft" && canEdit && draft.items.length > 1 ? <button type="button" className={styles.removeItemButton} onClick={() => setDraft((current) => current ? { ...current, items: current.items.filter((candidate) => candidate.key !== item.key) } : current)} disabled={pending}>Remove</button> : null}
        </fieldset>)}
      </div>

      <div className={styles.invoiceBottomGrid}>
        <div className={styles.compactForm}>
          <label><span>Notes</span><textarea rows={3} value={draft.notes} onChange={(event) => updateField("notes", event.target.value)} disabled={locked} /></label>
          <label><span>Terms</span><textarea rows={3} value={draft.terms} onChange={(event) => updateField("terms", event.target.value)} disabled={locked} /></label>
        </div>
        <div>
          <label className={styles.invoiceDiscount}><span>Discount ({invoice.currency})</span><MoneyCentsInput ariaLabel={`Discount (${invoice.currency})`} cents={draft.discountCents} onCentsChange={(discountCents) => updateField("discountCents", discountCents)} disabled={locked} /></label>
          <dl className={styles.invoiceTotals} data-testid="invoice-totals">
            <div><dt>Gross{invoice.gstRateBasisPoints > 0 ? " incl GST" : ""}</dt><dd>{money(calculated.grossCents)}</dd></div>
            <div><dt>Discount</dt><dd>−{money(draft.discountCents)}</dd></div>
            <div><dt>{invoice.gstRateBasisPoints > 0 ? "Subtotal ex GST" : "Subtotal"}</dt><dd>{money(calculated.subtotalExGstCents)}</dd></div>
            {invoice.gstRateBasisPoints > 0 ? <div><dt>GST ({invoice.gstRateBasisPoints / 100}%)</dt><dd>{money(calculated.gstCents)}</dd></div> : null}
            <div><dt>Total{invoice.gstRateBasisPoints > 0 ? " incl GST" : ""}</dt><dd>{money(calculated.totalInclGstCents)}</dd></div>
          </dl>
        </div>
      </div>

      <div className={styles.invoiceActions}>
        {!downloadAtTop ? <a className={styles.secondaryAdminButton} href={`${invoicePdfBase}/${invoice.id}/pdf`}>Download PDF</a> : null}
        {invoice.status === "draft" && canEdit ? <><button type="button" className={styles.secondaryAdminButton} onClick={saveDraft} disabled={pending}>Save draft</button><button type="button" onClick={issueInvoice} disabled={pending}>Issue invoice</button></> : null}
        {invoice.status === "issued" && canEdit ? <><label><span>Void reason</span><input value={voidReason} onChange={(event) => setVoidReason(event.target.value)} disabled={pending} /></label><button type="button" className={styles.dangerButton} onClick={voidInvoice} disabled={pending}>Void invoice</button></> : null}
      </div>
      {invoice.status === "void" ? <p className={styles.authorityBanner}><strong>Voided:</strong> {invoice.voidReason}</p> : null}
      <p className={styles.formFeedback} aria-live="polite">{feedback}</p>
        </div>
        <div className={styles.persistedInvoicePreview}>
          <InvoicePreview invoiceNumber={invoice.invoiceNumber} draft={draft} currency={invoice.currency} gstRateBasisPoints={invoice.gstRateBasisPoints} totals={calculated} />
        </div>
      </div>
    </section>
  );
}
