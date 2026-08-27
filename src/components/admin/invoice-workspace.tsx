"use client";

import { useMemo, useState } from "react";
import { ResizableSeparator } from "@/components/shared/resizable-separator";
import type { MarketCurrency } from "@/domain/markets/types";
import { calculateInvoiceTotals } from "@/server/invoices/invoice-domain";
import { InvoicePreview } from "./invoice-preview";
import styles from "./admin.module.css";

export type InvoiceWorkspaceItem = Readonly<{
  key: string;
  code: string;
  description: string;
  quantityMilli: number;
  rateInclGstCents: number;
}>;

export type InvoiceWorkspaceDraft = Readonly<{
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
  items: readonly InvoiceWorkspaceItem[];
}>;

export type InvoiceWorkspaceTotals = Readonly<ReturnType<typeof calculateInvoiceTotals>>;

export function invoiceRequestDraft(draft: InvoiceWorkspaceDraft) {
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

function InvoiceMoneyInput({
  ariaLabel,
  cents,
  onCentsChange,
}: Readonly<{
  ariaLabel: string;
  cents: number;
  onCentsChange: (cents: number) => void;
}>) {
  const [displayValue, setDisplayValue] = useState(() => (cents / 100).toFixed(2));

  function parse(value: string) {
    if (!value || value === ".") return null;
    const next = Math.round(Number(value) * 100);
    return Number.isSafeInteger(next) && next >= 0 && next <= 100_000_000 ? next : null;
  }

  return <input
    aria-label={ariaLabel}
    inputMode="decimal"
    pattern="[0-9]+(?:\.[0-9]{0,2})?"
    value={displayValue}
    onChange={(event) => {
      const value = event.target.value;
      if (!/^\d*(?:\.\d{0,2})?$/.test(value)) return;
      setDisplayValue(value);
      const next = parse(value);
      if (next !== null) onCentsChange(next);
    }}
    onBlur={() => {
      const next = parse(displayValue) ?? 0;
      setDisplayValue((next / 100).toFixed(2));
      onCentsChange(next);
    }}
  />;
}

export function InvoiceWorkspace({
  invoiceNumber = "INV-DRAFT",
  currency = "NZD",
  gstRateBasisPoints = 1_500,
  draft,
  onChange,
  onClose,
  downloadEndpoint = "/api/forms/invoices/draft/pdf",
}: Readonly<{
  invoiceNumber?: string;
  currency?: MarketCurrency;
  gstRateBasisPoints?: number;
  draft: InvoiceWorkspaceDraft;
  onChange: (draft: InvoiceWorkspaceDraft) => void;
  onClose: () => void;
  downloadEndpoint?: string;
}>) {
  const [feedback, setFeedback] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [editorWidth, setEditorWidth] = useState(440);
  const [mobileView, setMobileView] = useState<"edit" | "preview">("edit");
  const totals = useMemo(() => calculateInvoiceTotals(draft, gstRateBasisPoints), [draft, gstRateBasisPoints]);

  function field<K extends keyof Omit<InvoiceWorkspaceDraft, "items">>(key: K, value: InvoiceWorkspaceDraft[K]) {
    onChange({ ...draft, [key]: value });
  }

  function item(key: string, patch: Partial<InvoiceWorkspaceItem>) {
    onChange({ ...draft, items: draft.items.map((current) => current.key === key ? { ...current, ...patch } : current) });
  }

  async function download() {
    setDownloading(true);
    setFeedback("");
    try {
      const response = await fetch(downloadEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: invoiceRequestDraft(draft), currency, gstRateBasisPoints }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || "The draft PDF could not be created.");
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${invoiceNumber}.pdf`;
      anchor.hidden = true;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setFeedback("Draft PDF downloaded.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "The draft PDF could not be created.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className={styles.invoiceWorkspaceOverlay} role="dialog" aria-modal="true" aria-labelledby="invoice-workspace-title">
      <header className={styles.invoiceWorkspaceHeader}>
        <div><span>Invoice</span><h2 id="invoice-workspace-title">Tax invoice preview</h2></div>
        <div><button type="button" onClick={download} disabled={downloading}>{downloading ? "Preparing…" : "Download PDF"}</button><button type="button" className={styles.secondaryAdminButton} onClick={onClose}>Close</button></div>
      </header>
      <div className={styles.invoiceWorkspaceViewSwitch} role="group" aria-label="Invoice workspace view">
        <button type="button" aria-pressed={mobileView === "edit"} onClick={() => setMobileView("edit")}>Edit invoice</button>
        <button type="button" aria-pressed={mobileView === "preview"} onClick={() => setMobileView("preview")}>Preview invoice</button>
      </div>
      <div
        className={styles.invoiceWorkspaceLayout}
        data-testid="invoice-workspace-layout"
        data-mobile-view={mobileView}
        style={{ "--invoice-editor-width": `${editorWidth}px` } as React.CSSProperties}
      >
        <div className={styles.invoiceWorkspaceEditor}>
          <section><h3>Invoice details</h3><div className={styles.invoiceWorkspaceGrid}>
            <label><span>Invoice No.</span><input value={invoiceNumber} readOnly /></label>
            <label><span>Date</span><input aria-label="Invoice date" type="date" value={draft.invoiceDate} onChange={(event) => field("invoiceDate", event.target.value)} /></label>
            <label><span>Due Date</span><input aria-label="Due date" type="date" value={draft.dueDate} onChange={(event) => field("dueDate", event.target.value)} /></label>
            <label><span>Reference</span><input value={draft.reference} onChange={(event) => field("reference", event.target.value)} /></label>
          </div></section>
          <section><h3>From</h3><div className={styles.invoiceWorkspaceGrid}>
            <label className={styles.fullField}><span>Business Address</span><textarea rows={4} value={draft.businessAddress} onChange={(event) => field("businessAddress", event.target.value)} /></label>
            <label><span>Email</span><input type="email" value={draft.businessEmail} onChange={(event) => field("businessEmail", event.target.value)} /></label>
            <label><span>Phone</span><input value={draft.businessPhone} onChange={(event) => field("businessPhone", event.target.value)} /></label>
            <label><span>Website</span><input value={draft.businessWebsite} onChange={(event) => field("businessWebsite", event.target.value)} /></label>
            <label><span>GST No.</span><input value={draft.gstNumber} onChange={(event) => field("gstNumber", event.target.value)} /></label>
            <label><span>Bank Account</span><input value={draft.bankAccount} onChange={(event) => field("bankAccount", event.target.value)} /></label>
          </div></section>
          <section><h3>To</h3><div className={styles.invoiceWorkspaceGrid}>
            <label className={styles.fullField}><span>Customer / Delivery Address</span><textarea rows={5} value={draft.deliveryAddress} onChange={(event) => onChange({ ...draft, customerAddress: event.target.value, deliveryAddress: event.target.value })} /></label>
            <label><span>Customer Name</span><input value={draft.customerName} onChange={(event) => field("customerName", event.target.value)} /></label>
            <label><span>Customer Email</span><input type="email" value={draft.customerEmail} onChange={(event) => field("customerEmail", event.target.value)} /></label>
          </div></section>
          <section><h3>Line items</h3>{draft.items.map((current, index) => <div className={styles.invoiceWorkspaceItem} key={current.key}>
            <label><span>Code</span><input aria-label={`Item ${index + 1} code`} value={current.code} onChange={(event) => item(current.key, { code: event.target.value })} /></label>
            <label><span>Description</span><textarea aria-label={`Item ${index + 1} description`} value={current.description} onChange={(event) => item(current.key, { description: event.target.value })} /></label>
            <label><span>Qty</span><input aria-label={`Item ${index + 1} quantity`} type="number" min="0.001" step="0.001" value={current.quantityMilli / 1_000} onChange={(event) => item(current.key, { quantityMilli: Math.max(1, Math.round(Number(event.target.value) * 1_000)) })} /></label>
            <label><span>Price incl GST</span><InvoiceMoneyInput ariaLabel={`Item ${index + 1} price`} cents={current.rateInclGstCents} onCentsChange={(rateInclGstCents) => item(current.key, { rateInclGstCents })} /></label>
          </div>)}</section>
          <section><h3>GST / Notes</h3><div className={styles.invoiceWorkspaceGrid}>
            <label><span>Discount</span><InvoiceMoneyInput ariaLabel="Discount" cents={draft.discountCents} onCentsChange={(discountCents) => field("discountCents", discountCents)} /></label>
            <label className={styles.fullField}><span>Notes</span><textarea rows={3} value={draft.notes} onChange={(event) => field("notes", event.target.value)} /></label>
            <label className={styles.fullField}><span>Terms</span><textarea rows={3} value={draft.terms} onChange={(event) => field("terms", event.target.value)} /></label>
          </div></section>
          <p aria-live="polite">{feedback}</p>
        </div>
        <ResizableSeparator
          className={styles.invoiceWorkspaceSeparator}
          label="Resize invoice editor"
          value={editorWidth}
          min={320}
          max={720}
          step={20}
          direction={1}
          onChange={setEditorWidth}
        />
        <div className={styles.invoicePreviewStage}><InvoicePreview invoiceNumber={invoiceNumber} draft={draft} currency={currency} gstRateBasisPoints={gstRateBasisPoints} totals={totals} /></div>
      </div>
    </div>
  );
}
