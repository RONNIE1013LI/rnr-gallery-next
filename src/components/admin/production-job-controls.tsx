"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClientId } from "@/lib/client-id";
import type { ProductionDeliveryMethod } from "@/server/db/schema";
import type { ProductionAssignee } from "./production-job-form";
import styles from "./admin.module.css";

type Finance = Readonly<{
  amountPayableCents: number;
  amountPaidCents: number;
  artistFeeCents: number | null;
  materialCostCents: number | null;
}>;

type Props = Readonly<{
  jobId: string;
  source: "web" | "manual";
  orderId: string | null;
  expectedUpdatedAt: string;
  status: string;
  paymentStatus: string;
  assignedUserId: string | null;
  urgent: boolean;
  neededDate: string;
  deliveryMethod: ProductionDeliveryMethod;
  deliveryAddress: string;
  paymentReconciliationStatus: string;
  designRequirements: string;
  internalNotes: string;
  milestones: Readonly<{
    fileSent: boolean;
    downloaded: boolean;
    printed: boolean;
    customerNotified: boolean;
    delivered: boolean;
    artistPaid: boolean;
    completed: boolean;
  }>;
  finance: Finance | null;
  assignees: readonly ProductionAssignee[];
  canManageFinance: boolean;
  customFields: readonly Readonly<{
    id: string;
    label: string;
    fieldType: string;
    options: readonly string[];
    required: boolean;
    value: string;
  }>[];
  jobApiBase?: string;
  orderBasePath?: string | null;
}>;

function cents(value: FormDataEntryValue | null) {
  const amount = Number(String(value ?? "0"));
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Enter valid non-negative NZD amounts.");
  return Math.round(amount * 100);
}

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function ProductionJobControls(props: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function mutate(payload: Record<string, unknown>) {
    setPending(true);
    setFeedback("");
    try {
      const response = await fetch(`${props.jobApiBase ?? "/api/admin/jobs"}/${props.jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          expectedUpdatedAt: props.expectedUpdatedAt,
          idempotencyKey: createClientId(),
        }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error || "The production job could not be updated.");
      setFeedback("Saved.");
      router.refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "The production job could not be updated.");
    } finally {
      setPending(false);
    }
  }

  function submitPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void mutate({
      assignedUserId: String(form.get("assignedUserId") ?? "") || null,
      urgent: form.get("urgent") === "on",
      neededDate: String(form.get("neededDate") ?? ""),
      deliveryMethod: String(form.get("deliveryMethod") ?? "post"),
      deliveryAddress: String(form.get("deliveryAddress") ?? ""),
      designRequirements: String(form.get("designRequirements") ?? ""),
      internalNotes: String(form.get("internalNotes") ?? ""),
      ...(props.source === "manual" ? { manualStatus: String(form.get("manualStatus") ?? props.status) } : {}),
    });
  }

  function submitMilestones(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void mutate({ milestones: {
      fileSent: form.get("fileSent") === "on",
      downloaded: form.get("downloaded") === "on",
      printed: form.get("printed") === "on",
      customerNotified: form.get("customerNotified") === "on",
      delivered: form.get("delivered") === "on",
      completed: form.get("completed") === "on",
    } });
  }

  function submitFinance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      void mutate({
        paymentReconciliationStatus: String(form.get("paymentReconciliationStatus") ?? "Not checked"),
        milestones: { artistPaid: form.get("artistPaid") === "on" },
        finance: {
          manualPaymentStatus: String(form.get("manualPaymentStatus") ?? props.paymentStatus),
          amountPayableCents: cents(form.get("amountPayable")),
          amountPaidCents: cents(form.get("amountPaid")),
          artistFeeCents: cents(form.get("artistFee")),
          materialCostCents: cents(form.get("materialCost")),
        },
      });
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Enter valid finance values.");
    }
  }

  function submitCustomFields(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void mutate({ customFields: props.customFields.map((field) => ({
      fieldId: field.id,
      value: String(form.get(`custom-${field.id}`) ?? ""),
    })) });
  }

  return (
    <div className={styles.actionStack}>
      {props.source === "web" && props.orderId ? (
        <section className={styles.panel}>
          <h2>Linked online order</h2>
          <p className={styles.mutedText}>Order status and payment remain authoritative in the original online order.</p>
          {props.orderBasePath !== null ? <Link className={styles.primaryAdminButton} href={`${props.orderBasePath ?? "/admin/orders"}/${props.orderId}`}>Update linked order</Link> : null}
        </section>
      ) : null}

      <section className={styles.panel}>
        <h2>Production plan</h2>
        <form className={styles.compactForm} onSubmit={submitPlan}>
          <label><span>Assign to</span><select name="assignedUserId" defaultValue={props.assignedUserId ?? ""} disabled={pending}><option value="">Unassigned</option>{props.assignees.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          {props.source === "manual" ? <label><span>Production status</span><select name="manualStatus" defaultValue={props.status} disabled={pending}>{["new", "designing", "awaiting_customer", "ready_to_print", "printing", "on_hold", "shipped", "completed", "cancelled"].map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></label> : null}
          <label><span>Needed date</span><input name="neededDate" type="date" defaultValue={props.neededDate} required disabled={pending} /></label>
          <label><span>Delivery</span><select name="deliveryMethod" defaultValue={props.deliveryMethod} disabled={pending}>
            <option value="post">Post</option><option value="pickup">Pickup</option><option value="delivery">Delivery</option>
            <option value="courier">Courier</option><option value="australia_shipping">Australia shipping</option><option value="email">Email</option><option value="other">Other</option>
          </select></label>
          <label><span>Delivery address</span><textarea name="deliveryAddress" rows={3} defaultValue={props.deliveryAddress} maxLength={5000} disabled={pending} /></label>
          <label className={styles.checkboxField}><input name="urgent" type="checkbox" defaultChecked={props.urgent} disabled={pending} /><span>Urgent confirmed</span></label>
          <label><span>Design requirements</span><textarea name="designRequirements" rows={4} defaultValue={props.designRequirements} maxLength={10000} disabled={pending} /></label>
          <label><span>Internal notes</span><textarea name="internalNotes" rows={4} defaultValue={props.internalNotes} maxLength={10000} disabled={pending} /></label>
          <button type="submit" disabled={pending}>Save production plan</button>
        </form>
      </section>

      <section className={styles.panel}>
        <h2>Milestones</h2>
        <form className={`${styles.compactForm} ${styles.milestoneForm}`} onSubmit={submitMilestones}>
          {(["fileSent", "downloaded", "printed", "customerNotified", "delivered", "completed"] as const).map((key) => <label className={styles.checkboxField} key={key}><input name={key} type="checkbox" defaultChecked={props.milestones[key]} disabled={pending} /><span>{label(key.replace(/([A-Z])/g, "_$1"))}</span></label>)}
          <button type="submit" disabled={pending}>Save milestones</button>
        </form>
      </section>

      {props.source === "manual" && props.canManageFinance && props.finance ? (
        <section className={styles.panel}>
          <h2>Finance</h2>
          <form className={styles.compactForm} onSubmit={submitFinance}>
            <label><span>Payment status</span><select name="manualPaymentStatus" defaultValue={props.paymentStatus} disabled={pending}>{["awaiting_payment", "processing", "paid", "failed", "cancelled", "refunded"].map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></label>
            <label><span>Amount payable (NZD)</span><input name="amountPayable" type="number" min="0" step="0.01" defaultValue={(props.finance.amountPayableCents / 100).toFixed(2)} disabled={pending} /></label>
            <label><span>Amount paid (NZD)</span><input name="amountPaid" type="number" min="0" step="0.01" defaultValue={(props.finance.amountPaidCents / 100).toFixed(2)} disabled={pending} /></label>
            <label><span>Artist fee (NZD)</span><input name="artistFee" type="number" min="0" step="0.01" defaultValue={((props.finance.artistFeeCents ?? 0) / 100).toFixed(2)} disabled={pending} /></label>
            <label><span>Material cost (NZD)</span><input name="materialCost" type="number" min="0" step="0.01" defaultValue={((props.finance.materialCostCents ?? 0) / 100).toFixed(2)} disabled={pending} /></label>
            <label><span>Payment reconciliation</span><select name="paymentReconciliationStatus" defaultValue={props.paymentReconciliationStatus} disabled={pending}>{["Not checked", "Arrive", "Afterpay", "Stripe", "Wise", "waitting..", "Checked1", "Checked2", "Checked3", "Checked4", "Checked5", "Checked6", "Other"].map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
            <label className={styles.checkboxField}><input name="artistPaid" type="checkbox" defaultChecked={props.milestones.artistPaid} disabled={pending} /><span>Artist paid</span></label>
            <button type="submit" disabled={pending}>Save finance</button>
          </form>
        </section>
      ) : null}
      {props.customFields.length ? <section className={styles.panel}>
        <h2>Custom fields</h2>
        <form className={styles.compactForm} onSubmit={submitCustomFields}>
          {props.customFields.map((field) => {
            const name = `custom-${field.id}`;
            if (field.fieldType === "textarea") return <label key={field.id}><span>{field.label}</span><textarea name={name} rows={3} defaultValue={field.value} required={field.required} disabled={pending} /></label>;
            if (field.fieldType === "select") return <label key={field.id}><span>{field.label}</span><select name={name} defaultValue={field.value} required={field.required} disabled={pending}><option value="">Select…</option>{field.options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
            if (field.fieldType === "radio") return <fieldset className={styles.productionItem} key={field.id}><legend>{field.label}</legend>{field.options.map((option) => <label className={styles.checkboxField} key={option}><input type="radio" name={name} value={option} defaultChecked={field.value === option} required={field.required} disabled={pending} /><span>{option}</span></label>)}</fieldset>;
            return <label key={field.id}><span>{field.label}</span><input name={name} type={field.fieldType} defaultValue={field.value} required={field.required} disabled={pending} /></label>;
          })}
          <button type="submit" disabled={pending}>Save custom fields</button>
        </form>
      </section> : null}
      <p className={styles.formFeedback} aria-live="polite">{feedback}</p>
    </div>
  );
}
