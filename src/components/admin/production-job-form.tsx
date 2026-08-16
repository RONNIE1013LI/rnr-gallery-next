"use client";

import { ClipboardEvent, FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClientId } from "@/lib/client-id";
import { parseCustomerBlock } from "@/domain/forms/customer-block-parser";
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
  productTitles?: readonly string[];
  customFields?: readonly ProductionFormField[];
  endpoint?: string;
  detailBasePath?: string;
}>;

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
  productTitles = [],
  customFields = [],
  endpoint = "/api/admin/jobs",
  detailBasePath = "/admin/jobs",
}: Props) {
  const router = useRouter();
  const [itemKeys, setItemKeys] = useState([0]);
  const [nextItemKey, setNextItemKey] = useState(1);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [pasteFeedback, setPasteFeedback] = useState("");
  const customerNameRef = useRef<HTMLInputElement>(null);
  const customerEmailRef = useRef<HTMLInputElement>(null);
  const customerPhoneRef = useRef<HTMLInputElement>(null);
  const deliveryMethodRef = useRef<HTMLSelectElement>(null);
  const deliveryAddressRef = useRef<HTMLTextAreaElement>(null);

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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFeedback("");
    try {
      const form = new FormData(event.currentTarget);
      const body = {
        idempotencyKey: createClientId(),
        customerName: String(form.get("customerName") ?? ""),
        customerEmail: String(form.get("customerEmail") ?? ""),
        customerPhone: String(form.get("customerPhone") ?? ""),
        customerSource: String(form.get("customerSource") ?? "other"),
        webOrderNumber: String(form.get("webOrderNumber") ?? ""),
        urgent: form.get("urgent") === "on",
        neededDate: String(form.get("neededDate") ?? ""),
        deliveryMethod: String(form.get("deliveryMethod") ?? "post"),
        deliveryAddress: String(form.get("deliveryAddress") ?? ""),
        paymentReconciliationStatus: canManageFinance
          ? String(form.get("paymentReconciliationStatus") ?? "Not checked")
          : "Not checked",
        assignedUserId: String(form.get("assignedUserId") ?? "") || null,
        designRequirements: String(form.get("designRequirements") ?? ""),
        internalNotes: String(form.get("internalNotes") ?? ""),
        manualStatus: String(form.get("manualStatus") ?? "new"),
        manualPaymentStatus: canManageFinance
          ? String(form.get("manualPaymentStatus") ?? "awaiting_payment")
          : "awaiting_payment",
        amountPayableCents: canManageFinance ? cents(form.get("amountPayable")) : 0,
        amountPaidCents: canManageFinance ? cents(form.get("amountPaid")) : 0,
        artistFeeCents: canManageFinance ? cents(form.get("artistFee")) : 0,
        materialCostCents: canManageFinance ? cents(form.get("materialCost")) : 0,
        artistPaid: canManageFinance && form.get("artistPaid") === "on",
        completed: form.get("completed") === "on",
        customFields: customFields.map((field) => ({
          fieldId: field.id,
          value: String(form.get(`custom-${field.id}`) ?? ""),
        })),
        items: itemKeys.map((key) => ({
          productTitle: String(form.get(`item-${key}-product`) ?? ""),
          sizeLabel: String(form.get(`item-${key}-size`) ?? ""),
          quantity: Number(form.get(`item-${key}-quantity`) ?? 1),
          designText: String(form.get(`item-${key}-design`) ?? ""),
          notes: String(form.get(`item-${key}-notes`) ?? ""),
        })),
      };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null) as {
        error?: string;
        job?: { id?: string; jobNumber?: string };
      } | null;
      if (!response.ok || !result?.job?.id) {
        throw new Error(result?.error || "The production job could not be created.");
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
    <form className={styles.productionForm} onSubmit={submit}>
      <section className={styles.formPanel}>
        <div className={styles.formSectionHeading}>
          <div><span>01</span><h2>Customer</h2></div>
          <p>Manual orders remain independent from online checkout and payment records.</p>
        </div>
        <div className={styles.formGrid}>
          <label><span>Customer name</span><input ref={customerNameRef} name="customerName" required maxLength={190} disabled={pending} /></label>
          <label><span>Email</span><input ref={customerEmailRef} name="customerEmail" type="email" maxLength={320} disabled={pending} /></label>
          <label><span>Phone</span><input ref={customerPhoneRef} name="customerPhone" type="tel" maxLength={80} disabled={pending} /></label>
          <label><span>Web order number</span><input name="webOrderNumber" maxLength={190} disabled={pending} /></label>
          <label><span>Customer source</span><select name="customerSource" defaultValue="messenger" disabled={pending}>
            <option value="phone">Phone</option><option value="messenger">Messenger</option><option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option><option value="instagram">Instagram</option><option value="tiktok">TikTok</option>
            <option value="market">Market</option><option value="walk_in">Walk in</option><option value="other">Other</option>
            <option value="rnr">R&amp;R</option><option value="wechat">WeChat</option>
          </select></label>
        </div>
        <p className={styles.fieldHint}>Enter at least an email address or phone number.</p>
      </section>

      <section className={styles.formPanel}>
        <div className={styles.formSectionHeading}>
          <div><span>02</span><h2>Products</h2></div>
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
                <label><span>Size</span><input name={`item-${key}-size`} required maxLength={190} placeholder="e.g. A2 or 85 cm × 200 cm" disabled={pending} /></label>
                <label className={styles.shortField}><span>Quantity</span><input name={`item-${key}-quantity`} type="number" min={1} max={100} defaultValue={1} required disabled={pending} /></label>
                <label className={styles.fullField}><span>Artwork direction</span><textarea name={`item-${key}-design`} rows={3} maxLength={5000} disabled={pending} /></label>
                <label className={styles.fullField}><span>Item notes</span><textarea name={`item-${key}-notes`} rows={2} maxLength={5000} disabled={pending} /></label>
              </div>
            </fieldset>
          ))}
        </div>
      </section>

      <section className={styles.formPanel}>
        <div className={styles.formSectionHeading}><div><span>03</span><h2>Production</h2></div></div>
        <div className={styles.formGrid}>
          <label><span>Needed date</span><input name="neededDate" type="date" defaultValue={defaultNeededDate()} required disabled={pending} /></label>
          <label><span>Delivery</span><select ref={deliveryMethodRef} name="deliveryMethod" defaultValue="post" disabled={pending}>
            <option value="post">Post</option><option value="pickup">Pickup</option>
            <option value="delivery">Delivery</option><option value="courier">Courier</option>
            <option value="australia_shipping">Australia shipping</option><option value="email">Email</option><option value="other">Other</option>
          </select></label>
          <label className={styles.fullField}><span>Delivery address</span><textarea ref={deliveryAddressRef} name="deliveryAddress" rows={3} maxLength={5000} onPaste={pasteCustomerDetails} disabled={pending} /></label>
          {pasteFeedback ? <p className={`${styles.fieldHint} ${styles.fullField}`} role="status">{pasteFeedback}</p> : null}
          <label><span>Assign to</span><select name="assignedUserId" defaultValue="" disabled={pending}><option value="">Unassigned</option>{assignees.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.email}</option>)}</select></label>
          <label><span>Production status</span><select name="manualStatus" defaultValue="new" disabled={pending}>{["new", "designing", "awaiting_customer", "ready_to_print", "printing", "on_hold", "shipped", "completed", "cancelled"].map((status) => <option value={status} key={status}>{status.replaceAll("_", " ")}</option>)}</select></label>
          <label className={styles.checkboxField}><input name="urgent" type="checkbox" disabled={pending} /><span>Urgent order confirmed with customer</span></label>
          <label className={styles.checkboxField}><input name="completed" type="checkbox" disabled={pending} /><span>Completed</span></label>
          <label className={styles.fullField}><span>Design requirements</span><textarea name="designRequirements" rows={4} maxLength={10000} disabled={pending} /></label>
          <label className={styles.fullField}><span>Internal notes</span><textarea name="internalNotes" rows={4} maxLength={10000} disabled={pending} /></label>
        </div>
      </section>

      {canManageFinance ? (
        <section className={styles.formPanel}>
          <div className={styles.formSectionHeading}><div><span>04</span><h2>Finance</h2></div><p>Restricted to administrators.</p></div>
          <div className={styles.formGrid}>
            <label><span>Payment status</span><select name="manualPaymentStatus" defaultValue="awaiting_payment" disabled={pending}>{["awaiting_payment", "processing", "paid", "failed", "cancelled", "refunded"].map((status) => <option value={status} key={status}>{status.replaceAll("_", " ")}</option>)}</select></label>
            <label><span>Amount payable (NZD)</span><input name="amountPayable" type="number" min="0" step="0.01" defaultValue="0.00" required disabled={pending} /></label>
            <label><span>Amount paid (NZD)</span><input name="amountPaid" type="number" min="0" step="0.01" defaultValue="0.00" required disabled={pending} /></label>
            <label><span>Artist fee (NZD)</span><input name="artistFee" type="number" min="0" step="0.01" defaultValue="0.00" required disabled={pending} /></label>
            <label><span>Material cost (NZD)</span><input name="materialCost" type="number" min="0" step="0.01" defaultValue="0.00" required disabled={pending} /></label>
            <label><span>Payment reconciliation</span><select name="paymentReconciliationStatus" defaultValue="Not checked" disabled={pending}>{["Not checked", "Arrive", "Afterpay", "ZIP PAY", "Stripe", "Wise", "waitting..", "Checked1", "Checked2", "Checked3", "Checked4", "Checked5", "Checked6", "Other"].map((status) => <option value={status} key={status}>{status}</option>)}</select></label>
            <label className={styles.checkboxField}><input name="artistPaid" type="checkbox" disabled={pending} /><span>Artist paid</span></label>
          </div>
        </section>
      ) : null}

      {customFields.length ? <section className={styles.formPanel}>
        <div className={styles.formSectionHeading}><div><span>{canManageFinance ? "05" : "04"}</span><h2>Custom information</h2></div><p>Additional studio fields configured by an administrator.</p></div>
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
        <button type="submit" disabled={pending}>{pending ? "Creating…" : "Create production job"}</button>
      </div>
    </form>
  );
}
