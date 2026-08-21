"use client";

import { useRef, useState } from "react";
import { LuFilter } from "react-icons/lu";

import type {
  FormFilterCondition,
  FormFilterField,
  FormFilterGroup,
  FormFilterOperator,
} from "@/server/forms/forms-workbench-service";
import styles from "./forms.module.css";
import { useContainedDialog } from "./use-contained-dialog";

const fields: readonly Readonly<{ value: FormFilterField; label: string; finance?: boolean }>[] = [
  { value: "urgent", label: "Urgency" },
  { value: "neededDate", label: "Delivery date" },
  { value: "deliveryMethod", label: "Delivery method" },
  { value: "customerSource", label: "Customer source" },
  { value: "status", label: "Order status" },
  { value: "paymentStatus", label: "Payment status" },
  { value: "assignedUserId", label: "Assigned artist" },
  { value: "bankRecon", label: "Bank reconciliation", finance: true },
];

const operators: Readonly<Record<FormFilterField, readonly Readonly<{ value: FormFilterOperator; label: string }>[]>> = {
  urgent: [{ value: "equals", label: "is" }],
  neededDate: [
    { value: "equals", label: "is" },
    { value: "before", label: "before" },
    { value: "after", label: "after" },
    { value: "between", label: "between" },
  ],
  deliveryMethod: [{ value: "equals", label: "is" }, { value: "notEquals", label: "is not" }],
  customerSource: [{ value: "equals", label: "is" }, { value: "notEquals", label: "is not" }],
  status: [{ value: "equals", label: "is" }, { value: "notEquals", label: "is not" }],
  paymentStatus: [{ value: "equals", label: "is" }, { value: "notEquals", label: "is not" }],
  assignedUserId: [
    { value: "equals", label: "is" },
    { value: "notEquals", label: "is not" },
    { value: "isEmpty", label: "is unassigned" },
  ],
  bankRecon: [{ value: "equals", label: "is" }, { value: "notEquals", label: "is not" }],
};

const valueOptions: Partial<Record<FormFilterField, readonly Readonly<{ value: string; label: string }>[]>> = {
  urgent: [{ value: "true", label: "Urgent" }, { value: "false", label: "Normal" }],
  deliveryMethod: [
    { value: "post", label: "Post" }, { value: "pickup", label: "Pick up" },
    { value: "delivery", label: "Delivery" }, { value: "email", label: "Email" },
    { value: "courier", label: "Courier" }, { value: "australia_shipping", label: "Australia Shipping" },
    { value: "other", label: "Other" },
  ],
  customerSource: [
    { value: "rnr", label: "R&R" }, { value: "web", label: "Web" },
    { value: "market", label: "Market" }, { value: "email", label: "Email" },
    { value: "instagram", label: "IG" }, { value: "tiktok", label: "TikTok" },
    { value: "whatsapp", label: "Whatsapp" }, { value: "wechat", label: "WeChat" },
    { value: "phone", label: "Phone" }, { value: "messenger", label: "Messenger" },
    { value: "walk_in", label: "Walk in" }, { value: "other", label: "Other" },
  ],
  status: ["new", "designing", "awaiting_customer", "ready_to_print", "printing", "on_hold", "shipped", "completed", "cancelled"]
    .map((value) => ({ value, label: value.replaceAll("_", " ") })),
  paymentStatus: ["awaiting_payment", "processing", "paid", "failed", "cancelled", "refunded"]
    .map((value) => ({ value, label: value.replaceAll("_", " ") })),
  bankRecon: ["Not checked", "Arrive", "Afterpay", "Stripe", "Wise", "waitting..", "Checked1", "Checked2", "Checked3", "Checked4", "Checked5", "Checked6", "Other"]
    .map((value) => ({ value, label: value })),
};

function newCondition(): FormFilterCondition {
  return { field: "urgent", operator: "equals", value: "true" };
}

function normalizedForField(field: FormFilterField): FormFilterCondition {
  if (field === "neededDate") return { field, operator: "equals", value: new Date().toISOString().slice(0, 10) };
  if (field === "assignedUserId") return { field, operator: "equals", value: "" };
  const first = valueOptions[field]?.[0]?.value ?? "";
  return { field, operator: "equals", value: first };
}

export function FormsFilterBuilder({
  conditions,
  match,
  canViewFinance,
  onApply,
}: Readonly<{
  conditions: readonly FormFilterCondition[];
  match: "and" | "or";
  canViewFinance: boolean;
  onApply: (group: FormFilterGroup) => void;
}>) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const matchRef = useRef<HTMLSelectElement>(null);
  const [open, setOpen] = useState(false);
  const [draftMatch, setDraftMatch] = useState<"and" | "or">(match);
  const [draft, setDraft] = useState<readonly FormFilterCondition[]>(conditions.length ? conditions : [newCondition()]);

  function show() {
    setDraftMatch(match);
    setDraft(conditions.length ? conditions : [newCondition()]);
    setOpen(true);
  }

  function close() {
    setOpen(false);
  }

  useContainedDialog({
    active: open,
    dialogRef,
    initialFocusRef: matchRef,
    additionalActiveRef: backdropRef,
    returnFocusRef: triggerRef,
    onClose: close,
  });

  function update(index: number, next: FormFilterCondition) {
    setDraft((current) => current.map((condition, position) => position === index ? next : condition));
  }

  function apply() {
    const ready = draft.filter((condition) => condition.operator === "isEmpty" ||
      (typeof condition.value === "string" ? condition.value : condition.value.every(Boolean)));
    onApply({ match: draftMatch, conditions: ready });
    close();
  }

  return (
    <div className={styles.filterBuilder}>
      <button
        ref={triggerRef}
        className={styles.filterButton}
        type="button"
        aria-expanded={open}
        aria-label={conditions.length ? `Filter orders (${conditions.length} active)` : "Filter orders"}
        onClick={show}
      >
        <span className={styles.filterButtonText}>Filter{conditions.length ? ` · ${conditions.length}` : ""}</span>
        <LuFilter className={styles.filterButtonIcon} aria-hidden="true" />
        {conditions.length ? <span className={styles.filterButtonCount} aria-hidden="true">{conditions.length}</span> : null}
      </button>
      {open ? (
        <>
        <div
          ref={backdropRef}
          className={styles.filterBackdrop}
          data-testid="filter-backdrop"
          aria-hidden="true"
          onMouseDown={close}
        />
        <div
          ref={dialogRef}
          className={styles.filterPanel}
          role="dialog"
          aria-modal="true"
          aria-label="Order filters"
        >
          <div className={styles.filterHeading}>
            <strong>Filter orders</strong>
            <button type="button" aria-label="Close filters" onClick={close}>×</button>
          </div>
          <label className={styles.filterMatch}>
            <span>Match</span>
            <select ref={matchRef} value={draftMatch} onChange={(event) => setDraftMatch(event.target.value === "or" ? "or" : "and")}>
              <option value="and">all conditions</option>
              <option value="or">any condition</option>
            </select>
          </label>
          <h3 className={styles.filterGroupTitle}>Field combinations</h3>
          <div className={styles.filterRows}>
            {draft.map((condition, index) => {
              const options = valueOptions[condition.field];
              const isBetween = condition.operator === "between";
              const values = typeof condition.value === "string" ? [condition.value] : condition.value;
              return (
                <div className={styles.filterRow} key={`${index}-${condition.field}`}>
                  <select
                    aria-label={`Filter field ${index + 1}`}
                    value={condition.field}
                    onChange={(event) => update(index, normalizedForField(event.target.value as FormFilterField))}
                  >
                    {fields.filter((field) => canViewFinance || !field.finance).map((field) => (
                      <option key={field.value} value={field.value}>{field.label}</option>
                    ))}
                  </select>
                  <select
                    aria-label={`Filter operator ${index + 1}`}
                    value={condition.operator}
                    onChange={(event) => {
                      const operator = event.target.value as FormFilterOperator;
                      update(index, {
                        ...condition,
                        operator,
                        value: operator === "between" ? [values[0] || new Date().toISOString().slice(0, 10), values[1] || values[0] || new Date().toISOString().slice(0, 10)] : values[0] ?? "",
                      });
                    }}
                  >
                    {operators[condition.field].map((operator) => <option key={operator.value} value={operator.value}>{operator.label}</option>)}
                  </select>
                  {condition.operator === "isEmpty" ? <span className={styles.filterNoValue}>No value needed</span> : options ? (
                    <select
                      aria-label={`Filter value ${index + 1}`}
                      value={values[0] ?? ""}
                      onChange={(event) => update(index, { ...condition, value: event.target.value })}
                    >
                      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  ) : (
                    <span className={styles.filterValues}>
                      <input
                        aria-label={`Filter value ${index + 1}`}
                        type={condition.field === "neededDate" ? "date" : "text"}
                        value={values[0] ?? ""}
                        onChange={(event) => update(index, { ...condition, value: isBetween ? [event.target.value, values[1] ?? ""] : event.target.value })}
                      />
                      {isBetween ? <input
                        aria-label={`Filter end value ${index + 1}`}
                        type="date"
                        value={values[1] ?? ""}
                        onChange={(event) => update(index, { ...condition, value: [values[0] ?? "", event.target.value] })}
                      /> : null}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove filter ${index + 1}`}
                    onClick={() => setDraft((current) => current.filter((_, position) => position !== index))}
                  >×</button>
                </div>
              );
            })}
          </div>
          <button type="button" className={styles.addFilterButton} onClick={() => setDraft((current) => current.length < 20 ? [...current, newCondition()] : current)}>+ Add condition</button>
          <div className={styles.filterActions}>
            <button type="button" onClick={() => { onApply({ match: "and", conditions: [] }); close(); }}>Reset filters</button>
            <button type="button" className={styles.filterApply} onClick={apply}>Apply filters</button>
          </div>
        </div>
        </>
      ) : null}
    </div>
  );
}
