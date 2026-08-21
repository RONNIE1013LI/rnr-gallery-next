"use client";

import Image from "next/image";
import { ClipboardEvent, FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClientId } from "@/lib/client-id";
import { parseCustomerBlock } from "@/domain/forms/customer-block-parser";
import { FORM_OPTION_SETS } from "@/domain/forms/forms-parity";
import type { InvoiceBusiness } from "@/server/invoices/invoice-business";
import type { ProductionFileSummary } from "@/server/production/production-proof-service";
import { InvoicePanel } from "./invoice-panel";
import { InvoiceWorkspace, invoiceRequestDraft, type InvoiceWorkspaceDraft } from "./invoice-workspace";
import { MoneyCentsInput } from "./money-cents-input";
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

export type ExistingManualProductionOrder = Readonly<{
  id: string;
  jobNumber: string;
  expectedUpdatedAt: string;
  submittedAt: string;
  updatedAt: string;
  submittedBy: string;
  size: string;
  sizeOther: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerSource: string;
  urgent: boolean;
  neededDate: string;
  deliveryMethod: string;
  deliveryAddress: string;
  paymentReconciliationStatus: string;
  assignedUserId: string | null;
  internalNotes: string;
  manualStatus: string;
  amountPayableCents: number;
  amountPaidCents: number;
  materialCostCents: number;
  milestones: Readonly<{
    fileSent: boolean;
    downloaded: boolean;
    printed: boolean;
    completed: boolean;
    customerNotified: boolean;
    delivered: boolean;
  }>;
  audit: readonly Readonly<{
    id: string;
    action: string;
    actorName: string;
    createdAt: string;
  }>[];
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
  manualEntryLayout?: boolean;
  existingManualOrder?: ExistingManualProductionOrder;
  existingPaymentProofs?: readonly ProductionFileSummary[];
  canDeleteFiles?: boolean;
  canEdit?: boolean;
  canUpdateProductionStatus?: boolean;
  canUpdateDeliveryStatus?: boolean;
  invoicePdfBase?: string;
  onSaved?: () => void;
  onBack?: () => void;
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
  proofs: readonly Readonly<{ proof: File; uploadIdempotencyKey: string }>[];
  nextProofIndex: number;
  statusIdempotencyKey: string | null;
  desiredFinance: PaymentFinanceSnapshot;
  phase: "upload_proof" | "update_payment_status";
}>;

type PendingPaymentProof = Readonly<{
  id: number;
  file: File;
  previewUrl: string | null;
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

function manualProductTitle(size: string) {
  if (/^A[0-5]$/.test(size)) return "Canvas";
  if (size === "PullUpBanner") return "Roll Up Banner";
  if (size.startsWith("Banner ")) return "Wall Banner";
  return "Manual custom order";
}

function auditLabel(value: string) {
  return value.replaceAll(".", "_").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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
  manualEntryLayout = false,
  existingManualOrder,
  existingPaymentProofs = [],
  canDeleteFiles = false,
  canEdit = true,
  canUpdateProductionStatus = true,
  canUpdateDeliveryStatus = true,
  invoicePdfBase = "/api/admin/invoices",
  onSaved,
  onBack,
}: Props) {
  const router = useRouter();
  const [itemKeys, setItemKeys] = useState([0]);
  const [nextItemKey, setNextItemKey] = useState(1);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [paymentProofError, setPaymentProofError] = useState("");
  const [paymentProofs, setPaymentProofs] = useState<readonly PendingPaymentProof[]>([]);
  const [paymentRecovery, setPaymentRecovery] = useState<PaymentRecovery | null>(null);
  const [pasteFeedback, setPasteFeedback] = useState("");
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceDraft, setInvoiceDraft] = useState<InvoiceWorkspaceDraft | null>(null);
  const [amountPayableCents, setAmountPayableCents] = useState(existingManualOrder?.amountPayableCents ?? 0);
  const [amountPaidCents, setAmountPaidCents] = useState(existingManualOrder?.amountPaidCents ?? 0);
  const [artistFeeCents, setArtistFeeCents] = useState(0);
  const [materialCostCents, setMaterialCostCents] = useState(existingManualOrder?.materialCostCents ?? 0);
  const [savedPaymentProofs, setSavedPaymentProofs] = useState(() => existingPaymentProofs.filter((file) => file.kind === "payment_proof"));
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(existingManualOrder?.expectedUpdatedAt ?? "");
  const formRef = useRef<HTMLFormElement>(null);
  const customerNameRef = useRef<HTMLInputElement>(null);
  const customerEmailRef = useRef<HTMLInputElement>(null);
  const customerPhoneRef = useRef<HTMLInputElement>(null);
  const deliveryMethodRef = useRef<HTMLSelectElement>(null);
  const deliveryAddressRef = useRef<HTMLTextAreaElement>(null);
  const paymentProofRef = useRef<HTMLInputElement>(null);
  const paymentProofsRef = useRef<readonly PendingPaymentProof[]>([]);
  const nextPaymentProofId = useRef(1);
  const operatorName = existingManualOrder?.submittedBy ?? submittedBy;
  const visibleSubmittedBy = operatorName.includes("@") ? "Current operator" : operatorName.trim() || "Current operator";
  const formDisabled = pending || Boolean(existingManualOrder && !canEdit);

  useEffect(() => () => {
    for (const proof of paymentProofsRef.current) {
      if (proof.previewUrl) URL.revokeObjectURL(proof.previewUrl);
    }
  }, []);

  function pasteCustomerDetails(event: ClipboardEvent<HTMLTextAreaElement>) {
    const textValue = event.clipboardData.getData("text/plain");
    if (!textValue.includes("\n")) return;
    event.preventDefault();
    const parsed = parseCustomerBlock(
      textValue,
      deliveryMethodRef.current?.value ?? "post",
    );
    if (deliveryAddressRef.current) deliveryAddressRef.current.value = textValue;
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

  function selectPaymentProofs(files: FileList | readonly File[]) {
    setPaymentProofError("");
    const additions = Array.from(files).filter((file) => file.size > 0).map((file) => ({
      id: nextPaymentProofId.current++,
      file,
      previewUrl: file.type.startsWith("image/") && typeof URL.createObjectURL === "function"
        ? URL.createObjectURL(file)
        : null,
    }));
    setPaymentProofs((current) => {
      const next = [...current, ...additions];
      paymentProofsRef.current = next;
      return next;
    });
  }

  function removePaymentProof(id: number) {
    setPaymentProofs((current) => {
      const removed = current.find((proof) => proof.id === id);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      const next = current.filter((proof) => proof.id !== id);
      paymentProofsRef.current = next;
      return next;
    });
    setPaymentProofError("");
  }

  function openInvoice() {
    if (existingManualOrder) {
      setInvoiceOpen(true);
      return;
    }
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

  async function deleteSavedPaymentProof(file: ProductionFileSummary) {
    if (!existingManualOrder || !window.confirm("Delete this payment proof? This cannot be undone.")) return;
    setPending(true);
    setPaymentProofError("");
    try {
      const response = await fetch(`${endpoint}/${existingManualOrder.id}/files/${file.id}`, { method: "DELETE" });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "The payment proof could not be deleted.");
      setSavedPaymentProofs((current) => current.filter((candidate) => candidate.id !== file.id));
    } catch (error) {
      setPaymentProofError(error instanceof Error ? error.message : "The payment proof could not be deleted.");
    } finally {
      setPending(false);
    }
  }

  async function uploadProofFiles(jobId: string, proofs: readonly Readonly<{ proof: File; uploadIdempotencyKey: string }>[]) {
    for (const current of proofs) {
      const uploadBody = new FormData();
      uploadBody.set("kind", "payment_proof");
      uploadBody.set("idempotencyKey", current.uploadIdempotencyKey);
      uploadBody.set("file", current.proof);
      const response = await fetch(`${endpoint}/${jobId}/files`, { method: "POST", body: uploadBody });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "The payment proof could not be uploaded.");
    }
  }

  async function uploadPaymentProof(recovery: PaymentRecovery) {
    const current = recovery.proofs[recovery.nextProofIndex];
    if (!current) return;
    const uploadBody = new FormData();
    uploadBody.set("kind", "payment_proof");
    uploadBody.set("idempotencyKey", current.uploadIdempotencyKey);
    uploadBody.set("file", current.proof);
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
      while (nextRecovery.nextProofIndex < nextRecovery.proofs.length) {
        try {
          await uploadPaymentProof(nextRecovery);
        } catch {
          setPaymentRecovery(nextRecovery);
          setFeedback(`Created ${nextRecovery.jobNumber} as Awaiting payment. Payment proof upload failed. Retry the same order.`);
          setPending(false);
          return;
        }
        nextRecovery = { ...nextRecovery, nextProofIndex: nextRecovery.nextProofIndex + 1 };
        setPaymentRecovery(nextRecovery);
      }
      if (!recovery.statusIdempotencyKey) {
        openCreatedJob(nextRecovery);
        return;
      }
      nextRecovery = { ...nextRecovery, phase: "update_payment_status" };
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
      const selectedPaymentProofs = paymentProofs.map((proof) => proof.file);
      const hasPaymentProof = selectedPaymentProofs.length > 0 || savedPaymentProofs.length > 0;
      const payableCents = canManageFinance ? amountPayableCents : 0;
      const paidCents = canManageFinance ? amountPaidCents : 0;
      const finalPaymentStatus = manualEntryLayout
        ? hasPaymentProof && paidCents > 0
          ? paidCents === payableCents ? "paid" : "processing"
          : "awaiting_payment"
        : canManageFinance
          ? String(form.get("manualPaymentStatus") ?? "awaiting_payment")
          : "awaiting_payment";
      const requiresPaymentProof = finalPaymentStatus === "processing" || finalPaymentStatus === "paid";
      if (requiresPaymentProof && !hasPaymentProof) {
        setPaymentProofError(`Attach the payment proof before marking this order as ${finalPaymentStatus}.`);
        setPending(false);
        return;
      }
      const oversizedProof = selectedPaymentProofs.find((proof) => proof.size > 25 * 1024 * 1024);
      if (oversizedProof) {
        setPaymentProofError(`${oversizedProof.name} must be 25 MB or smaller.`);
        setPending(false);
        return;
      }
      const desiredFinance = {
        manualPaymentStatus: finalPaymentStatus,
        amountPayableCents: payableCents,
        amountPaidCents: paidCents,
        artistFeeCents: canManageFinance ? artistFeeCents : 0,
        materialCostCents: canManageFinance ? materialCostCents : 0,
      };
      const createIdempotencyKey = createClientId();
      const proofUploads = selectedPaymentProofs.map((proof) => ({
        proof,
        uploadIdempotencyKey: createClientId(),
      }));
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
      const manualMilestoneEnabled = (name: string) => manualEntryLayout
        ? form.get(name) === "yes"
        : form.get(name) === "on";
      const deliveredSelection = canUpdateDeliveryStatus
        ? String(form.get("delivered") ?? "no")
        : existingManualOrder?.manualStatus === "on_hold"
          ? "hold"
          : existingManualOrder?.milestones.delivered
            ? "yes"
            : "no";
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
        manualStatus: manualEntryLayout && deliveredSelection === "hold"
          ? "on_hold"
          : existingManualOrder?.manualStatus === "on_hold"
            ? "new"
            : existingManualOrder?.manualStatus ?? String(form.get("manualStatus") ?? "new"),
        manualPaymentStatus: requiresPaymentProof ? "awaiting_payment" : finalPaymentStatus,
        amountPayableCents: desiredFinance.amountPayableCents,
        amountPaidCents: desiredFinance.amountPaidCents,
        artistFeeCents: desiredFinance.artistFeeCents,
        materialCostCents: desiredFinance.materialCostCents,
        artistPaid: canManageFinance && form.get("artistPaid") === "on",
        fileSent: manualMilestoneEnabled("fileSent"),
        downloaded: manualMilestoneEnabled("downloaded"),
        printed: manualMilestoneEnabled("printed"),
        customerNotified: manualMilestoneEnabled("customerNotified"),
        delivered: manualMilestoneEnabled("delivered"),
        completed: manualMilestoneEnabled("completed"),
        customFields: customFields.map((field) => ({
          fieldId: field.id,
          value: String(form.get(`custom-${field.id}`) ?? ""),
        })),
        items: (manualEntryLayout ? [0] : itemKeys).map((key) => ({
          productTitle: manualEntryLayout
            ? manualProductTitle(String(form.get(`item-${key}-size`) ?? ""))
            : String(form.get(`item-${key}-product`) ?? ""),
          sizeLabel: String(form.get(`item-${key}-size-other`) ?? "").trim()
            || String(form.get(`item-${key}-size`) ?? ""),
          quantity: Number(form.get(`item-${key}-quantity`) ?? 1),
          designText: String(form.get(`item-${key}-design`) ?? ""),
          notes: String(form.get(`item-${key}-notes`) ?? ""),
        })),
        ...(submittedInvoice ? { invoiceDraft: submittedInvoice } : {}),
      };
      if (existingManualOrder) {
        await uploadProofFiles(existingManualOrder.id, proofUploads);
        const updateBody = {
          expectedUpdatedAt,
          idempotencyKey: createIdempotencyKey,
          customerName: body.customerName,
          customerEmail: body.customerEmail,
          customerPhone: body.customerPhone,
          customerSource: body.customerSource,
          urgent: body.urgent,
          neededDate: body.neededDate,
          deliveryMethod: body.deliveryMethod,
          deliveryAddress: body.deliveryAddress,
          assignedUserId: body.assignedUserId,
          internalNotes: body.internalNotes,
          ...(canUpdateDeliveryStatus ? { manualStatus: body.manualStatus } : {}),
          ...(canManageFinance ? {
            paymentReconciliationStatus: body.paymentReconciliationStatus,
            finance: desiredFinance,
          } : {}),
          ...((canUpdateProductionStatus || canUpdateDeliveryStatus) ? { milestones: {
            ...(canUpdateProductionStatus ? {
            fileSent: body.fileSent,
            downloaded: body.downloaded,
            printed: body.printed,
            customerNotified: body.customerNotified,
            completed: body.completed,
            } : {}),
            ...(canUpdateDeliveryStatus ? { delivered: body.delivered } : {}),
          } } : {}),
          items: body.items,
        };
        const updateResponse = await fetch(`${endpoint}/${existingManualOrder.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updateBody),
        });
        const updateResult = await updateResponse.json().catch(() => null) as { error?: string; version?: string } | null;
        if (!updateResponse.ok) throw new Error(updateResult?.error || "The manual order could not be saved.");
        if (updateResult?.version) setExpectedUpdatedAt(updateResult.version);
        for (const proof of paymentProofsRef.current) {
          if (proof.previewUrl) URL.revokeObjectURL(proof.previewUrl);
        }
        paymentProofsRef.current = [];
        setPaymentProofs([]);
        setFeedback(`Saved ${existingManualOrder.jobNumber}.`);
        onSaved?.();
        setPending(false);
        return;
      }
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
      if (proofUploads.length) {
        const recovery: PaymentRecovery = {
          jobId: result.job.id,
          jobNumber: result.job.jobNumber ?? "production job",
          updatedAt: result.job.updatedAt ?? "",
          proofs: proofUploads,
          nextProofIndex: 0,
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
    <form ref={formRef} className={`${styles.productionForm} ${manualEntryLayout ? styles.manualEntryForm : ""}`} onSubmit={submit}>
      <div className={styles.formUtilityBar}>
        <span>Data entry</span>
        <div>
          {canManageFinance ? <button type="button" onClick={openInvoice} disabled={pending}>Invoice</button> : null}
          {onBack ? <button type="button" onClick={onBack}>Back</button> : <Link href={backHref}>Back</Link>}
        </div>
      </div>

      <section className={styles.formPanel}>
        {!manualEntryLayout ? <div className={styles.formSectionHeading}>
          <div><span>01</span><h2>Record summary</h2></div>
          <p>The numeric order ID is assigned when this record is saved.</p>
        </div> : null}
        <dl className={styles.formRecordSummary}>
          <div><dt>Submitted by</dt><dd>{visibleSubmittedBy}</dd></div>
          <div><dt>Ref No.</dt><dd>{existingManualOrder?.jobNumber ?? "—"}</dd></div>
          <div><dt>Submitted at</dt><dd>{existingManualOrder?.submittedAt ?? "—"}</dd></div>
          <div><dt>Updated at</dt><dd>{existingManualOrder?.updatedAt ?? "—"}</dd></div>
        </dl>
      </section>

      {manualEntryLayout ? <>
        <section className={styles.formPanel}>
          <div className={styles.formSectionHeading}><div><h2>Product / Size</h2></div></div>
          <div className={styles.manualFieldRows}>
            <label><span>Size</span><select name="item-0-size" defaultValue={existingManualOrder?.size ?? ""} required disabled={formDisabled}>
              <option value="" disabled>Please choose</option>
              {FORM_OPTION_SETS.size.map((size) => <option key={size} value={size}>{size}</option>)}
            </select></label>
            <label><span>Size Other</span><input name="item-0-size-other" defaultValue={existingManualOrder?.sizeOther ?? ""} maxLength={190} disabled={formDisabled} /></label>
          </div>
        </section>

        {canManageFinance ? <section className={styles.formPanel}>
          <div className={styles.formSectionHeading}><div><h2>Payment</h2></div></div>
          <div className={styles.manualFieldRows}>
            {canUploadFiles ? <label><span>PaymtProved</span><div>
              <input ref={paymentProofRef} name="paymentProof" type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf" aria-label="PaymtProved" aria-describedby="payment-proof-help payment-proof-error" onChange={(event) => selectPaymentProofs(event.currentTarget.files ?? [])} disabled={formDisabled} />
              {savedPaymentProofs.length || paymentProofs.length ? <div className={styles.paymentProofPreviewGrid}>
                {savedPaymentProofs.map((proof) => <article className={styles.paymentProofPreviewCard} key={proof.id}><div className={styles.paymentProofPreviewMedia}>
                  {proof.mediaType.startsWith("image/") && existingManualOrder ? <Image src={`${endpoint}/${existingManualOrder.id}/files/${proof.id}`} alt={`Payment proof ${proof.originalName}`} fill sizes="120px" unoptimized /> : <span>PDF</span>}
                  {canDeleteFiles && canEdit ? <button type="button" className={styles.paymentProofDeleteButton} aria-label={`Delete ${proof.originalName}`} disabled={pending} onClick={(event) => { event.preventDefault(); void deleteSavedPaymentProof(proof); }}><span aria-hidden="true">×</span></button> : null}
                </div></article>)}
                {paymentProofs.map((proof) => <article className={styles.paymentProofPreviewCard} key={proof.id}>
                <div className={styles.paymentProofPreviewMedia}>
                  {proof.previewUrl ? <Image src={proof.previewUrl} alt={`Payment proof ${proof.file.name}`} fill sizes="120px" unoptimized /> : <span>PDF</span>}
                  <button type="button" className={styles.paymentProofDeleteButton} aria-label={`Remove ${proof.file.name}`} disabled={pending} onClick={(event) => {
                    event.preventDefault();
                    removePaymentProof(proof.id);
                  }}><span aria-hidden="true">×</span></button>
                </div>
              </article>)}</div> : null}
              <small id="payment-proof-help" className={styles.fieldHint}>Choose any number of JPG, PNG, WebP, HEIC, HEIF or PDF files. Maximum 25 MB each.</small>
              {paymentProofError ? <p id="payment-proof-error" className={styles.fieldHint} role="alert">{paymentProofError}</p> : null}
            </div></label> : null}
            <label><span>AmtPayable</span><MoneyCentsInput ariaLabel="AmtPayable" name="amountPayable" cents={amountPayableCents} onCentsChange={setAmountPayableCents} required disabled={formDisabled} /></label>
            <label><span>AmtPaid</span><MoneyCentsInput ariaLabel="AmtPaid" name="amountPaid" cents={amountPaidCents} onCentsChange={setAmountPaidCents} required disabled={formDisabled} /></label>
            <label><span>AmtOwe</span><input value={(Math.max(0, amountPayableCents - amountPaidCents) / 100).toFixed(2)} readOnly aria-readonly="true" /></label>
            <label><span>BankRecon</span><select className={styles.manualContentControl} name="paymentReconciliationStatus" defaultValue={existingManualOrder?.paymentReconciliationStatus ?? "Not checked"} disabled={formDisabled}>{["Not checked", "Arrive", "Afterpay", "Stripe", "Wise", "waitting..", "Checked1", "Checked2", "Checked3", "Checked4", "Checked5", "Checked6", "Other"].map((status) => <option value={status} key={status}>{status}</option>)}</select></label>
          </div>
        </section> : null}

        <section className={styles.formPanel}>
          <div className={styles.formSectionHeading}><div><h2>Design &amp; Notes</h2></div></div>
          <div className={styles.manualFieldRows}>
            <label><span>Remark</span><textarea name="internalNotes" defaultValue={existingManualOrder?.internalNotes ?? ""} rows={5} maxLength={10000} disabled={formDisabled} /></label>
          </div>
        </section>

        <section className={styles.formPanel}>
          <div className={styles.formSectionHeading}><div><h2>Delivery</h2></div></div>
          <div className={styles.manualFieldRows}>
            <label className={styles.manualToggleRow}><span>Urgent?</span><span><input name="urgent" type="checkbox" defaultChecked={existingManualOrder?.urgent ?? false} disabled={formDisabled} /> Urgent</span></label>
            <label><span>DlvryMethod</span><select className={styles.manualContentControl} ref={deliveryMethodRef} name="deliveryMethod" defaultValue={existingManualOrder?.deliveryMethod ?? "post"} disabled={formDisabled}>
              <option value="post">Post</option><option value="pickup">Pick up</option><option value="delivery">Delivery</option><option value="courier">Courier</option><option value="australia_shipping">Australia Shipping</option><option value="email">Email</option><option value="other">Other</option>
            </select></label>
            <label><span>DlvryDate</span><input className={styles.manualContentControl} name="neededDate" type="date" defaultValue={existingManualOrder?.neededDate ?? defaultNeededDate()} required disabled={formDisabled} /></label>
            <label><span>DlvryAddr</span><div><textarea ref={deliveryAddressRef} name="deliveryAddress" defaultValue={existingManualOrder?.deliveryAddress ?? ""} rows={5} maxLength={5000} onPaste={pasteCustomerDetails} disabled={formDisabled} />{pasteFeedback ? <p className={styles.fieldHint} role="status">{pasteFeedback}</p> : null}</div></label>
          </div>
        </section>

        <section className={styles.formPanel}>
          <div className={styles.formSectionHeading}><div><h2>Customer info</h2></div></div>
          <div className={styles.manualFieldRows}>
            <label><span>CustSource</span><select className={styles.manualContentControl} name="customerSource" defaultValue={existingManualOrder?.customerSource ?? "messenger"} disabled={formDisabled}>
              <option value="phone">Phone</option><option value="messenger">Messenger</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="instagram">Instagram</option><option value="tiktok">TikTok</option><option value="market">Market</option><option value="walk_in">Walk in</option><option value="other">Other</option><option value="rnr">R&amp;R</option><option value="wechat">WeChat</option>
            </select></label>
            <label><span>Cust.Name</span><input ref={customerNameRef} name="customerName" defaultValue={existingManualOrder?.customerName ?? ""} required maxLength={190} disabled={formDisabled} /></label>
            <label><span>PhoneNo.</span><input ref={customerPhoneRef} name="customerPhone" defaultValue={existingManualOrder?.customerPhone ?? ""} type="tel" maxLength={80} disabled={formDisabled} /></label>
            <label><span>Email</span><input ref={customerEmailRef} name="customerEmail" defaultValue={existingManualOrder?.customerEmail ?? ""} type="email" maxLength={320} disabled={formDisabled} /></label>
          </div>
          <p className={styles.fieldHint}>Enter at least an email address or phone number.</p>
        </section>

        <section className={styles.formPanel}>
          <div className={styles.formSectionHeading}><div><h2>Internal Production Status</h2></div></div>
          <div className={styles.manualFieldRows}>
            <label><span>Assign Artist</span><select className={styles.manualContentControl} name="assignedUserId" defaultValue={existingManualOrder?.assignedUserId ?? ""} disabled={formDisabled}><option value="">NO</option>{assignees.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
            {([ ["fileSent", "File Sent"], ["downloaded", "Download"], ["printed", "Printed"], ["completed", "Completed"], ["customerNotified", "Cust.Notified"] ] as const).map(([name, text]) => <label key={name}><span>{text}</span><select className={styles.manualContentControl} name={name} defaultValue={existingManualOrder?.milestones[name] ? "yes" : "no"} disabled={formDisabled || !canUpdateProductionStatus}><option value="no">NO</option><option value="yes">YES</option></select></label>)}
            <label><span>Delivered</span><select className={styles.manualContentControl} name="delivered" defaultValue={existingManualOrder?.manualStatus === "on_hold" ? "hold" : existingManualOrder?.milestones.delivered ? "yes" : "no"} disabled={formDisabled || !canUpdateDeliveryStatus}><option value="no">NO</option><option value="yes">YES</option><option value="hold">HOLD</option></select></label>
          </div>
        </section>

        {canManageFinance ? <section className={styles.formPanel}>
          <div className={styles.formSectionHeading}><div><h2>Cost / Profit</h2></div></div>
          <div className={styles.manualFieldRows}><label><span>Material Cost</span><MoneyCentsInput ariaLabel="Material Cost" name="materialCost" cents={materialCostCents} onCentsChange={setMaterialCostCents} required disabled={formDisabled} /></label></div>
          <input name="artistFee" type="hidden" value="0" />
        </section> : null}

        <section className={styles.formPanel}>
          <div className={styles.formSectionHeading}><div><h2>Operation history</h2></div></div>
          {existingManualOrder?.audit.length ? <div className={styles.timeline}>{existingManualOrder.audit.map((entry) => <article key={entry.id}><strong>{auditLabel(entry.action)}</strong><span>{entry.actorName}</span><small>{entry.createdAt}</small></article>)}</div> : <p className={styles.mutedText}>Operation history will appear after this manual order is saved.</p>}
        </section>
      </> : <>

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
            <label><span>Amount payable (NZD)</span><MoneyCentsInput ariaLabel="Amount payable (NZD)" name="amountPayable" cents={amountPayableCents} onCentsChange={setAmountPayableCents} required disabled={pending} /></label>
            <label><span>Amount paid (NZD)</span><MoneyCentsInput ariaLabel="Amount paid (NZD)" name="amountPaid" cents={amountPaidCents} onCentsChange={setAmountPaidCents} required disabled={pending} /></label>
            <label><span>Amount owing (NZD)</span><input value={(Math.max(0, amountPayableCents - amountPaidCents) / 100).toFixed(2)} readOnly aria-readonly="true" /></label>
            <label><span>Payment reconciliation</span><select name="paymentReconciliationStatus" defaultValue="Not checked" disabled={pending}>{["Not checked", "Arrive", "Afterpay", "Stripe", "Wise", "waitting..", "Checked1", "Checked2", "Checked3", "Checked4", "Checked5", "Checked6", "Other"].map((status) => <option value={status} key={status}>{status}</option>)}</select></label>
          </div>
          {canUploadFiles ? <div className={styles.formGrid}>
            <div className={styles.fullField}>
              <label><span>Payment proof</span><input
                ref={paymentProofRef}
                name="paymentProof"
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
                aria-describedby="payment-proof-help payment-proof-error"
                onChange={(event) => selectPaymentProofs(event.currentTarget.files ?? [])}
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
            <label><span>Artist fee (NZD)</span><MoneyCentsInput ariaLabel="Artist fee (NZD)" name="artistFee" cents={artistFeeCents} onCentsChange={setArtistFeeCents} required disabled={pending} /></label>
            <label><span>Material cost (NZD)</span><MoneyCentsInput ariaLabel="Material cost (NZD)" name="materialCost" cents={materialCostCents} onCentsChange={setMaterialCostCents} required disabled={pending} /></label>
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
      </>}

      <div className={styles.formSubmitBar}>
        <p aria-live="polite">{feedback}</p>
        {paymentRecovery ? <button type="button" onClick={retryPaymentRecovery} disabled={pending}>
          {pending
            ? "Retrying…"
            : paymentRecovery.phase === "upload_proof" ? "Retry payment proof" : "Retry payment status"}
        </button> : null}
        {canEdit ? <button type="submit" disabled={pending || Boolean(paymentRecovery)}>{pending ? (existingManualOrder ? "Saving…" : "Creating…") : existingManualOrder ? "Save order" : "Create production job"}</button> : null}
      </div>
    </form>
    {!existingManualOrder && invoiceOpen && invoiceDraft ? <InvoiceWorkspace draft={invoiceDraft} onChange={setInvoiceDraft} onClose={() => setInvoiceOpen(false)} /> : null}
    {existingManualOrder && invoiceOpen ? <div
      className={`${styles.invoiceWorkspaceOverlay} ${styles.persistedInvoiceOverlay}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Edit invoice INV-${existingManualOrder.jobNumber}`}
    >
      <header className={styles.invoiceWorkspaceHeader}>
        <div><strong>Invoice</strong><span>INV-{existingManualOrder.jobNumber}</span></div>
        <button type="button" onClick={() => setInvoiceOpen(false)}>Close</button>
      </header>
      <div className={styles.persistedInvoiceOverlayBody}>
        <InvoicePanel
          jobId={existingManualOrder.id}
          jobApiBase={endpoint}
          invoicePdfBase={invoicePdfBase}
          canEdit={canManageFinance && canEdit}
          downloadAtTop
        />
      </div>
    </div> : null}
    </>
  );
}
