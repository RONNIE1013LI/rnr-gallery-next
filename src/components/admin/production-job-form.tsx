"use client";

import { ClipboardEvent, FormEvent, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClientId } from "@/lib/client-id";
import { parseCustomerBlock } from "@/domain/forms/customer-block-parser";
import { FORM_OPTION_SETS } from "@/domain/forms/forms-parity";
import type { InvoiceBusiness } from "@/server/invoices/invoice-business";
import { InvoiceWorkspace, invoiceRequestDraft, type InvoiceWorkspaceDraft } from "./invoice-workspace";
import styles from "./admin.module.css";

export type ProductionAssignee = Readonly<{
  id: string;
  name: string;
  email: string;
}>;
export type ProductionFormField = Readonly<{
  id: string;
  label: string;
  fieldType: "text" | "textarea" | "number" | "date" | "select" | "radio";
  options: readonly string[];
  required: boolean;
}>;

type Props = Readonly<{
  assignees: readonly ProductionAssignee[];
  canManageFinance: boolean;
  canUploadFiles?: boolean;
  productTitles?: readonly string[];
  customFields?: readonly ProductionFormField[];
  endpoint?: string;
  detailBasePath?: string;
  invoiceBusiness?: InvoiceBusiness;
  submittedBy?: string;
  backHref?: string;
}>;

type PaymentFinanceSnapshot = Readonly<{
  manualPaymentStatus: string;
  amountPayableCents: number;
  amountPaidCents: number;
  artistFeeCents: number;
  materialCostCents: number;
}>;

type PaymentRecovery = Readonly<{
  jobId: string;
  jobNumber: string;
  updatedAt: string;
  proof: File;
  uploadIdempotencyKey: string;
  statusIdempotencyKey: string | null;
  desiredFinance: PaymentFinanceSnapshot;
  phase: "upload_proof" | "update_payment_status";
}>;

const fallbackInvoiceBusiness: InvoiceBusiness = Object.freeze({
  name: "R&R Gallery",
  address: "11 Para Close\nFairview Heights\nAuckland 0632\nNew Zealand",
  email: "customerservice@rnrgallery.com",
  phone: "+64 21 023 48948",
  website: "https://rnrgallery.com/",
  gstNumber: "125-796-389",
  bankAccount: "04-2021-0317735-07",
});

function dateValue(date: Date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function defaultNeededDate() {
  const date = new Date();
  let businessDays = 0;
  while (businessDays < 5) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) businessDays += 1;
  }
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function cents(value: FormDataEntryValue | null) {
  const amount = Number(String(value ?? "0"));
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Enter valid non-negative NZD amounts.");
  return Math.round(amount * 100);
}

export function ProductionJobForm({
  assignees,
  canManageFinance,
  canUploadFiles = false,
  productTitles = [],
  customFields = [],
  endpoint = "/api/admin/jobs",
  detailBasePath = "/admin/jobs",
  invoiceBusiness = fallbackInvoiceBusiness,
  submittedBy = "Current operator",
  backHref = "/admin/jobs",
}: Props) {
  const router = useRouter();
  const [itemKeys, setItemKeys] = useState([0]);
  const [nextItemKey, setNextItemKey] = useState(1);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [paymentProofError, setPaymentProofError] = useState("");
  const [paymentRecovery, setPaymentRecovery] = useState<PaymentRecovery | null>(null);
  const [pasteFeedback, setPasteFeedback] = useState("");
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceDraft, setInvoiceDraft] = useState<InvoiceWorkspaceDraft | null>(null);
  const [amountPayable, setAmountPayable] = useState("0.00");
  const [amountPaid, setAmountPaid] = useState("0.00");
  const formRef = useRef<HTMLFormElement>(null);
  const customerNameRef = useRef<HTMLInputElement>(null);
  const customerEmailRef = useRef<HTMLInputElement>(null);
  const customerPhoneRef = useRef<HTMLInputElement>(null);
  const deliveryMethodRef = useRef<HTMLSelectElement>(null);
  const deliveryAddressRef = useRef<HTMLTextAreaElement>(null);
  const paymentProofRef = useRef<HTMLInputElement>(null);

  function pasteCustomerDetails(event: ClipboardEvent<HTMLTextAreaElement>) {
    const textValue = event.clipboardData.getData("text/plain");
    if (!textValue.includes("\n")) return;
    event.preventDefault();
    const parsed = parseCustomerBlock(
      textValue,
      deliveryMethodRef.current?.value ?? "post",
    );
    if (deliveryAddressRef.current) deliveryAddressRef.current.value = parsed.deliveryAddress;
    const filled: string[] = [];
    if (parsed.customerName && customerNameRef.current && !customerNameRef.current.value.trim()) {
      customerNameRef.current.value = parsed.customerName;
      filled.push("name");
    }
    if (parsed.customerPhone && customerPhoneRef.current && !customerPhoneRef.current.value.trim()) {
      customerPhoneRef.current.value = parsed.customerPhone;
      filled.push("phone");
    }
    if (parsed.customerEmail && customerEmailRef.current && !customerEmailRef.current.value.trim()) {
      customerEmailRef.current.value = parsed.customerEmail;
      filled.push("email");
    }
    setPasteFeedback(filled.length
      ? `Filled ${filled.join(", ")}; check the delivery address before submitting.`
      : "No empty customer fields were changed; check the delivery address before submitting.");
  }

  function openInvoice() {
    if (!formRef.current) return;
    if (!invoiceDraft) {
      const form = new FormData(formRef.current);
      const today = new Date();
      const due = new Date(today);
      due.setDate(due.getDate() + 7);
      const firstItemKey = itemKeys[0] ?? 0;
      const product = String(form.get(`item-${firstItemKey}-product`) ?? "").trim();
      const size = String(form.get(`item-${firstItemKey}-size-other`) ?? "").trim()
        || String(form.get(`item-${firstItemKey}-size`) ?? "").trim();
      setInvoiceDraft({
        invoiceDate: dateValue(today), dueDate: dateValue(due), reference: "DRAFT",
        businessName: invoiceBusiness.name, businessAddress: invoiceBusiness.address,
        businessEmail: invoiceBusiness.email, businessPhone: invoiceBusiness.phone,
        businessWebsite: invoiceBusiness.website, gstNumber: invoiceBusiness.gstNumber,
        bankAccount: invoiceBusiness.bankAccount,
        customerName: String(form.get("customerName") ?? ""),
        customerEmail: String(form.get("customerEmail") ?? ""),
        customerAddress: String(form.get("deliveryAddress") ?? ""),
        deliveryAddress: String(form.get("deliveryAddress") ?? ""),
        discountCents: 0, notes: "Thank you for your business!", terms: "Payment is due within 7 days.",
        items: [{ key: createClientId(), code: size || "PRD", description: [product, size].filter(Boolean).join(" — ") || "Order item", quantityMilli: 1_000, rateInclGstCents: canManageFinance ? cents(form.get("amountPayable")) : 0 }],
      });
    }
    setInvoiceOpen(true);
  }

  async function uploadPaymentProof(recovery: PaymentRecovery) {
    const uploadBody = new FormData();
    uploadBody.set("kind", "payment_proof");
    uploadBody.set("idempotencyKey", recovery.uploadIdempotencyKey);
    uploadBody.set("file", recovery.proof);
    const response = await fetch(`${endpoint}/${recovery.jobId}/files`, {
      method: "POST",
      body: uploadBody,
    });
    const result = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) throw new Error(result?.error || "The payment proof could not be uploaded.");
  }

  async function updatePaymentStatus(recovery: PaymentRecovery) {
    if (!recovery.updatedAt || !recovery.statusIdempotencyKey) {
      throw new Error("The saved order version is unavailable.");
    }
    const response = await fetch(`${endpoint}/${recovery.jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedUpdatedAt: recovery.updatedAt,
        idempotencyKey: recovery.statusIdempotencyKey,
        finance: recovery.desiredFinance,
      }),
    });
    const result = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) throw new Error(result?.error || "The payment status could not be updated.");
  }

  function openCreatedJob(recovery: PaymentRecovery) {
    setPaymentRecovery(null);
    setFeedback(`Created ${recovery.jobNumber}. Opening details…`);
    router.push(`${detailBasePath}/${recovery.jobId}`);
  }

  async function continuePaymentRecovery(recovery: PaymentRecovery) {
    let nextRecovery = recovery;
    if (recovery.phase === "upload_proof") {
      try {
        await uploadPaymentProof(recovery);
      } catch {
        setPaymentRecovery(recovery);
        setFeedback(`Created ${recovery.jobNumber} as Awaiting payment. Payment proof upload failed. Retry the same order.`);
        setPending(false);
        return;
      }
      if (!recovery.statusIdempotencyKey) {
        openCreatedJob(recovery);
        return;
      }
      nextRecovery = { ...recovery, phase: "update_payment_status" };
      setPaymentRecovery(nextRecovery);
    }
    try {
      await updatePaymentStatus(nextRecovery);
    } catch {
      setPaymentRecovery(nextRecovery);
      setFeedback(`Created ${nextRecovery.jobNumber} as Awaiting payment. Payment status update failed. Retry the same order.`);
      setPending(false);
      return;
    }
    openCreatedJob(nextRecovery);
  }

  async function retryPaymentRecovery() {
    if (!paymentRecovery) return;
    setPending(true);
    setFeedback("");
    await continuePaymentRecovery(paymentRecovery);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (paymentRecovery) return;
    setPending(true);
    setFeedback("");
    setPaymentProofError("");
    try {
      const form = new FormData(event.currentTarget);
      const finalPaymentStatus = canManageFinance
        ? String(form.get("manualPaymentStatus") ?? "awaiting_payment")
        : "awaiting_payment";
      const selectedProof = paymentProofRef.current?.files?.[0];
      const paymentProof = selectedProof && selectedProof.size > 0
        ? selectedProof
        : null;
      const requiresPaymentProof = finalPaymentStatus === "processing" || finalPaymentStatus === "paid";
      if (requiresPaymentProof && !paymentProof) {
        setPaymentProofError(`Attach the payment proof before marking this order as ${finalPaymentStatus}.`);
        setPending(false);
        return;
      }
      if (paymentProof && paymentProof.size > 25 * 1024 * 1024) {
        setPaymentProofError("Payment proof must be 25 MB or smaller.");
        setPending(false);
        return;
      }
      const desiredFinance = {
        manualPaymentStatus: finalPaymentStatus,
        amountPayableCents: canManageFinance ? cents(form.get("amountPayable")) : 0,
        amountPaidCents: canManageFinance ? cents(form.get("amountPaid")) : 0,
        artistFeeCents: canManageFinance ? cents(form.get("artistFee")) : 0,
        materialCostCents: canManageFinance ? cents(form.get("materialCost")) : 0,
      };
      const createIdempotencyKey = createClientId();
      const uploadIdempotencyKey = paymentProof ? createClientId() : null;
      const statusIdempotencyKey = requiresPaymentProof ? createClientId() : null;
      const customerName = String(form.get("customerName") ?? "");
      const customerEmail = String(form.get("customerEmail") ?? "");
      const deliveryAddress = String(form.get("deliveryAddress") ?? "");
      const submittedInvoice = invoiceDraft ? invoiceRequestDraft({
        ...invoiceDraft,
        customerName: invoiceDraft.customerName || customerName,
        customerEmail: invoiceDraft.customerEmail || customerEmail,
        customerAddress: invoiceDraft.customerAddress || deliveryAddress,
        deliveryAddress: invoiceDraft.deliveryAddress || deliveryAddress,
      }) : undefined;
      const body = {
        idempotencyKey: createIdempotencyKey,
        customerName,
        customerEmail,
        customerPhone: String(form.get("customerPhone") ?? ""),
        customerSource: String(form.get("customerSource") ?? "other"),
        webOrderNumber: String(form.get("webOrderNumber") ?? ""),
        urgent: form.get("urgent") === "on",
        neededDate: String(form.get("neededDate") ?? ""),
        deliveryMethod: String(form.get("deliveryMethod") ?? "post"),
        deliveryAddress,
        paymentReconciliationStatus: canManageFinance
          ? String(form.get("paymentReconciliationStatus") ?? "Not checked")
          : "Not checked",
        assignedUserId: String(form.get("assignedUserId") ?? "") || null,
        designRequirements: String(form.get("designRequirements") ?? ""),
        internalNotes: String(form.get("internalNotes") ?? ""),
        manualStatus: String(form.get("manualStatus") ?? "new"),
        manualPaymentStatus: requiresPaymentProof ? "awaiting_payment" : finalPaymentStatus,
        amountPayableCents: desiredFinance.amountPayableCents,
        amountPaidCents: desiredFinance.amountPaidCents,
        artistFeeCents: desiredFinance.artistFeeCents,
        materialCostCents: desiredFinance.materialCostCents,
        artistPaid: canManageFinance && form.get("artistPaid") === "on",
        completed: form.get("completed") === "on",
        customFields: customFields.map((field) => ({
          fieldId: field.id,
          value: String(form.get(`custom-${field.id}`) ?? ""),
        })),
        items: itemKeys.map((key) => ({
          productTitle: String(form.get(`item-${key}-product`) ?? ""),
          sizeLabel: String(form.get(`item-${key}-size-other`) ?? "").trim()
            || String(form.get(`item-${key}-size`) ?? ""),
          quantity: Number(form.get(`item-${key}-quantity`) ?? 1),
          designText: String(form.get(`item-${key}-design`) ?? ""),
          notes: String(form.get(`item-${key}-notes`) ?? ""),
        })),
        ...(submittedInvoice ? { invoiceDraft: submittedInvoice } : {}),
      };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null) as {
        error?: string;
        job?: { id?: string; jobNumber?: string; updatedAt?: string };
      } | null;
      if (!response.ok || !result?.job?.id) {
        throw new Error(result?.error || "The production job could not be created.");
      }
      if (paymentProof && uploadIdempotencyKey) {
        const recovery: PaymentRecovery = {
          jobId: result.job.id,
          jobNumber: result.job.jobNumber ?? "production job",
          updatedAt: result.job.updatedAt ?? "",
          proof: paymentProof,
          uploadIdempotencyKey,
          statusIdempotencyKey,
          desiredFinance,
          phase: "upload_proof",
        };
        setPaymentRecovery(recovery);
        await continuePaymentRecovery(recovery);
        return;
      }
      setFeedback(`Created ${result.job.jobNumber ?? "production job"}. Opening details…`);
      router.push(`${detailBasePath}/${result.job.id}`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "The production job could not be created.");
      setPending(false);
    }
  }

  function addItem() {
    setItemKeys((current) => [...current, nextItemKey]);
    setNextItemKey((current) => current + 1);
  }

  return (
    <>
    <form ref={formRef} className={styles.productionForm} onSubmit={submit}>
      <div className={styles.formUtilityBar}>
        <span>Data entry</span>
        <div>
          {canManageFinance ? <button type="button" onClick={openInvoice}>Invoice</button> : null}
          <Link href={backHref}>Back</Link>
        </div>
      </div>

      <section className={styles.formPanel}>
        <div className={styles.formSectionHeading}>
          <div><span>01</span><h2>Record summary</h2></div>
          <p>The numeric order ID is assigned when this record is saved.</p>
        </div>
        <dl className={styles.formRecordSummary}>
          <div><dt>Submitted by</dt><dd>{submittedBy}</dd></div>
          <div><dt>Ref No.</dt><dd>—</dd></div>
          <div><dt>Submitted at</dt><dd>—</dd></div>
          <div><dt>Updated at</dt><dd>—</dd></div>
        </dl>
      </section>

      <section className={styles.formPanel}>
        <div className={styles.formSectionHeading}><div><span>02</span><h2>Order info</h2></div></div>
        <div className={styles.formGrid}>
          <label><span>Web order number</span><input name="webOrderNumber" maxLength={190} disabled={pending} /></label>
        </div>
      </section>

      <section className={styles.formPanel}>
        <div className={styles.formSectionHeading}>
          <div><span>03</span><h2>Product / Size</h2></div>
          <button className={styles.secondaryAdminButton} type="button" onClick={addItem} disabled={pending || itemKeys.length >= 20}>Add item</button>
        </div>
        <datalist id="rnr-production-products">
          {productTitles.map((title) => <option key={title} value={title} />)}
        </datalist>
        <div className={styles.productionItems}>
          {itemKeys.map((key, index) => (
            <fieldset className={styles.productionItem} key={key}>
              <legend>Item {index + 1}</legend>
              {itemKeys.length > 1 ? <button type="button" className={styles.removeItemButton} onClick={() => setItemKeys((current) => current.filter((itemKey) => itemKey !== key))}>Remove</button> : null}
              <div className={styles.formGrid}>
                <label><span>Product</span><input name={`item-${key}-product`} list="rnr-production-products" required maxLength={190} disabled={pending} /></label>
                <label><span>Size</span><select name={`item-${key}-size`} defaultValue="" required disabled={pending}>
                  <option value="" disabled>Please choose</option>
                  {FORM_OPTION_SETS.size.map((size) => <option key={size} value={size}>{size}</option>)}
                </select></label>
                <label><span>Size other</span><input name={`item-${key}-size-other`} maxLength={190} placeholder="Only if the standard size does not apply" disabled={pending} /></label>
                <label className={styles.shortField}><span>Quantity</span><input name={`item-${key}-quantity`} type="number" min={1} max={100} defaultValue={1} required disabled={pending} /></label>
              </div>
            </fieldset>
          ))}
        </div>
      </section>

      {canManageFinance ? (
        <section className={styles.formPanel}>
          <div className={styles.formSectionHeading}><div><span>04</span><h2>Payment</h2></div><p>Restricted to authorised finance staff.</p></div>
          <div className={styles.formGrid}>
            <label><span>Payment status</span><select name="manualPaymentStatus" defaultValue="awaiting_payment" disabled={pending}>{["awaiting_payment", "processing", "paid", "failed", "cancelled", "refunded"].map((status) => <option value={status} key={status}>{status.replaceAll("_", " ")}</option>)}</select></label>
            <label><span>Amount payable (NZD)</span><input name="amountPayable" type="number" min="0" step="0.01" value={amountPayable} onChange={(event) => setAmountPayable(event.target.value)} required disabled={pending} /></label>
            <label><span>Amount paid (NZD)</span><input name="amountPaid" type="number" min="0" step="0.01" value={amountPaid} onChange={(event) => setAmountPaid(event.target.value)} required disabled={pending} /></label>
            <label><span>Amount owing (NZD)</span><input value={Math.max(0, (Number(amountPayable) || 0) - (Number(amountPaid) || 0)).toFixed(2)} readOnly aria-readonly="true" /></label>
            <label><span>Payment reconciliation</span><select name="paymentReconciliationStatus" defaultValue="Not checked" disabled={pending}>{["Not checked", "Arrive", "Afterpay", "ZIP PAY", "Stripe", "Wise", "waitting..", "Checked1", "Checked2", "Checked3", "Checked4", "Checked5", "Checked6", "Other"].map((status) => <option value={status} key={status}>{status}</option>)}</select></label>
          </div>
          {canUploadFiles ? <div className={styles.formGrid}>
            <div className={styles.fullField}>
              <label><span>Payment proof</span><input
                ref={paymentProofRef}
                name="paymentProof"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
                aria-describedby="payment-proof-help payment-proof-error"
                onChange={() => setPaymentProofError("")}
                disabled={pending}
              /></label>
              <small id="payment-proof-help" className={styles.fieldHint}>JPG, PNG, WebP, HEIC, HEIF or PDF. Maximum 25 MB.</small>
              {paymentProofError ? <p id="payment-proof-error" className={styles.fieldHint} role="alert">{paymentProofError}</p> : null}
            </div>
          </div> : null}
        </section>
      ) : null}

      <section className={styles.formPanel}>
        <div className={styles.formSectionHeading}><div><span>{canManageFinance ? "05" : "04"}</span><h2>Delivery</h2></div></div>
        <div className={styles.formGrid}>
          <label className={styles.checkboxField}><input name="urgent" type="checkbox" disabled={pending} /><span>Urgent order confirmed with customer</span></label>
          <label><span>Delivery method</span><select ref={deliveryMethodRef} name="deliveryMethod" defaultValue="post" disabled={pending}>
            <option value="post">Post</option><option value="pickup">Pickup</option>
            <option value="delivery">Delivery</option><option value="courier">Courier</option>
            <option value="australia_shipping">Australia shipping</option><option value="email">Email</option><option value="other">Other</option>
          </select></label>
          <label><span>Needed date</span><input name="neededDate" type="date" defaultValue={defaultNeededDate()} required disabled={pending} /></label>
          <label className={styles.fullField}><span>Delivery address</span><textarea ref={deliveryAddressRef} name="deliveryAddress" rows={5} maxLength={5000} onPaste={pasteCustomerDetails} disabled={pending} /></label>
          {pasteFeedback ? <p className={`${styles.fieldHint} ${styles.fullField}`} role="status">{pasteFeedback}</p> : null}
        </div>
      </section>

      <section className={styles.formPanel}>
        <div className={styles.formSectionHeading}><div><span>{canManageFinance ? "06" : "05"}</span><h2>Customer info</h2></div><p>Pasting a full customer block into Delivery address fills only empty fields.</p></div>
        <div className={styles.formGrid}>
          <label><span>Customer source</span><select name="customerSource" defaultValue="messenger" disabled={pending}>
            <option value="phone">Phone</option><option value="messenger">Messenger</option><option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option><option value="instagram">Instagram</option><option value="tiktok">TikTok</option>
            <option value="market">Market</option><option value="walk_in">Walk in</option><option value="other">Other</option>
            <option value="rnr">R&amp;R</option><option value="wechat">WeChat</option>
          </select></label>
          <label><span>Customer name</span><input ref={customerNameRef} name="customerName" required maxLength={190} disabled={pending} /></label>
          <label><span>Phone</span><input ref={customerPhoneRef} name="customerPhone" type="tel" maxLength={80} disabled={pending} /></label>
          <label><span>Email</span><input ref={customerEmailRef} name="customerEmail" type="email" maxLength={320} disabled={pending} /></label>
        </div>
        <p className={styles.fieldHint}>Enter at least an email address or phone number.</p>
      </section>

      <section className={styles.formPanel}>
        <div className={styles.formSectionHeading}><div><span>{canManageFinance ? "07" : "06"}</span><h2>Internal Production Status</h2></div></div>
        <div className={styles.formGrid}>
          <label><span>Assign to</span><select name="assignedUserId" defaultValue="" disabled={pending}><option value="">Unassigned</option>{assignees.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.email}</option>)}</select></label>
          <label><span>Production status</span><select name="manualStatus" defaultValue="new" disabled={pending}>{["new", "designing", "awaiting_customer", "ready_to_print", "printing", "on_hold", "shipped", "completed", "cancelled"].map((status) => <option value={status} key={status}>{status.replaceAll("_", " ")}</option>)}</select></label>
          <label className={styles.checkboxField}><input name="completed" type="checkbox" disabled={pending} /><span>Completed</span></label>
        </div>
      </section>

      {canManageFinance ? (
        <section className={styles.formPanel}>
          <div className={styles.formSectionHeading}><div><span>08</span><h2>Cost / Profit</h2></div><p>Restricted to authorised finance staff.</p></div>
          <div className={styles.formGrid}>
            <label><span>Artist fee (NZD)</span><input name="artistFee" type="number" min="0" step="0.01" defaultValue="0.00" required disabled={pending} /></label>
            <label><span>Material cost (NZD)</span><input name="materialCost" type="number" min="0" step="0.01" defaultValue="0.00" required disabled={pending} /></label>
            <label className={styles.checkboxField}><input name="artistPaid" type="checkbox" disabled={pending} /><span>Artist paid</span></label>
          </div>
        </section>
      ) : null}

      {customFields.length ? <section className={styles.formPanel}>
        <div className={styles.formSectionHeading}><div><span>{canManageFinance ? "09" : "07"}</span><h2>Custom information</h2></div><p>Additional studio fields configured by an administrator.</p></div>
        <div className={styles.formGrid}>{customFields.map((field) => {
          const name = `custom-${field.id}`;
          if (field.fieldType === "textarea") return <label className={styles.fullField} key={field.id}><span>{field.label}</span><textarea name={name} rows={3} required={field.required} maxLength={10000} disabled={pending} /></label>;
          if (field.fieldType === "select") return <label key={field.id}><span>{field.label}</span><select name={name} required={field.required} defaultValue="" disabled={pending}><option value="">Select…</option>{field.options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
          if (field.fieldType === "radio") return <fieldset className={styles.productionItem} key={field.id}><legend>{field.label}</legend>{field.options.map((option) => <label className={styles.checkboxField} key={option}><input type="radio" name={name} value={option} required={field.required} disabled={pending} /><span>{option}</span></label>)}</fieldset>;
          return <label key={field.id}><span>{field.label}</span><input name={name} type={field.fieldType} required={field.required} maxLength={field.fieldType === "text" ? 10000 : undefined} disabled={pending} /></label>;
        })}</div>
      </section> : null}

      <div className={styles.formSubmitBar}>
        <p aria-live="polite">{feedback}</p>
        {paymentRecovery ? <button type="button" onClick={retryPaymentRecovery} disabled={pending}>
          {pending
            ? "Retrying…"
            : paymentRecovery.phase === "upload_proof" ? "Retry payment proof" : "Retry payment status"}
        </button> : null}
        <button type="submit" disabled={pending || Boolean(paymentRecovery)}>{pending ? "Creating…" : "Create production job"}</button>
      </div>
    </form>
    {invoiceOpen && invoiceDraft ? <InvoiceWorkspace draft={invoiceDraft} onChange={setInvoiceDraft} onClose={() => setInvoiceOpen(false)} /> : null}
    </>
  );
}
