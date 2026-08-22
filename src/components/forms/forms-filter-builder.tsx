"use client";

import { useRef, useState, type ReactNode } from "react";
import { LuFilter } from "react-icons/lu";

import type {
  FormFilterCondition,
  FormFilterField,
  FormFilterGroup,
  FormFilterOperator,
} from "@/server/forms/forms-workbench-service";
import styles from "./forms.module.css";
import { useContainedDialog } from "./use-contained-dialog";

type FilterKind = "text" | "date" | "number" | "boolean" | "select" | "user";
type FilterOption = Readonly<{ value: string; label: string }>;
type FilterDefinition = Readonly<{
  value: FormFilterField;
  label: string;
  kind: FilterKind;
  options?: readonly FilterOption[];
  finance?: boolean;
  contact?: boolean;
  paymentProof?: boolean;
}>;

export type FormsFilterCustomField = Readonly<{
  id: string;
  label: string;
  fieldType: "text" | "textarea" | "number" | "date" | "select" | "radio";
  options: readonly string[];
  section: string;
}>;

const yesNo: readonly FilterOption[] = [{ value: "true", label: "Yes" }, { value: "false", label: "No" }];
const deliveryMethods: readonly FilterOption[] = [
    { value: "post", label: "Post" }, { value: "pickup", label: "Pick up" },
    { value: "delivery", label: "Delivery" }, { value: "email", label: "Email" },
    { value: "courier", label: "Courier" }, { value: "australia_shipping", label: "Australia Shipping" },
    { value: "other", label: "Other" },
  ];
const customerSources: readonly FilterOption[] = [
    { value: "rnr", label: "R&R" }, { value: "web", label: "Web" },
    { value: "market", label: "Market" }, { value: "email", label: "Email" },
    { value: "instagram", label: "IG" }, { value: "tiktok", label: "TikTok" },
    { value: "whatsapp", label: "Whatsapp" }, { value: "wechat", label: "WeChat" },
    { value: "phone", label: "Phone" }, { value: "messenger", label: "Messenger" },
    { value: "walk_in", label: "Walk in" }, { value: "other", label: "Other" },
  ];
const orderStatuses = ["new", "designing", "awaiting_customer", "ready_to_print", "printing", "on_hold", "shipped", "completed", "cancelled"]
  .map((value) => ({ value, label: value.replaceAll("_", " ") }));
const paymentStatuses = ["awaiting_payment", "processing", "paid", "failed", "cancelled", "refunded"]
  .map((value) => ({ value, label: value.replaceAll("_", " ") }));
const bankStatuses = ["Not checked", "Arrive", "Afterpay", "Stripe", "Wise", "waitting..", "Checked1", "Checked2", "Checked3", "Checked4", "Checked5", "Checked6", "Other"]
  .map((value) => ({ value, label: value }));

const baseFields: readonly FilterDefinition[] = [
  { value: "submittedAt", label: "Submitted time", kind: "date" },
  { value: "updatedAt", label: "Updated date", kind: "date" },
  { value: "reference", label: "Ref No.", kind: "text" },
  { value: "productTitle", label: "Product", kind: "text" },
  { value: "size", label: "Size", kind: "text" },
  { value: "paymentProof", label: "Payment proof", kind: "boolean", options: yesNo, paymentProof: true },
  { value: "amountPayable", label: "Amount payable", kind: "number", finance: true },
  { value: "amountPaid", label: "Amount paid", kind: "number", finance: true },
  { value: "amountOwing", label: "Amount owing", kind: "number", finance: true },
  { value: "bankRecon", label: "Bank reconciliation", kind: "select", options: bankStatuses, finance: true },
  { value: "remark", label: "Remark", kind: "text" },
  { value: "designText", label: "Design text", kind: "text" },
  { value: "urgent", label: "Urgency", kind: "boolean", options: [{ value: "true", label: "Urgent" }, { value: "false", label: "Normal" }] },
  { value: "neededDate", label: "Delivery date", kind: "date" },
  { value: "deliveryMethod", label: "Delivery method", kind: "select", options: deliveryMethods },
  { value: "deliveryAddress", label: "Delivery address", kind: "text", contact: true },
  { value: "customerSource", label: "Customer source", kind: "select", options: customerSources },
  { value: "customerName", label: "Customer name", kind: "text" },
  { value: "customerPhone", label: "Phone", kind: "text", contact: true },
  { value: "customerEmail", label: "Email", kind: "text", contact: true },
  { value: "assignedUserId", label: "Assigned artist", kind: "user" },
  { value: "submittedByUserId", label: "Submitted by", kind: "user" },
  { value: "status", label: "Order status", kind: "select", options: orderStatuses },
  { value: "paymentStatus", label: "Payment status", kind: "select", options: paymentStatuses },
  { value: "fileSent", label: "File sent", kind: "boolean", options: yesNo },
  { value: "downloaded", label: "Downloaded", kind: "boolean", options: yesNo },
  { value: "printed", label: "Printed", kind: "boolean", options: yesNo },
  { value: "completed", label: "Completed", kind: "boolean", options: yesNo },
  { value: "customerNotified", label: "Customer notified", kind: "boolean", options: yesNo },
  { value: "delivered", label: "Delivered", kind: "boolean", options: yesNo },
  { value: "artistFee", label: "Artist fee", kind: "number", finance: true },
  { value: "materialCost", label: "Material cost", kind: "number", finance: true },
];

const operatorLabels: Readonly<Record<FormFilterOperator, string>> = {
  equals: "is", notEquals: "is not", before: "before", after: "after", between: "between",
  contains: "contains", greaterThan: "greater than", lessThan: "less than",
  isEmpty: "is empty", isNotEmpty: "is not empty",
};

function operatorsFor(field: FilterDefinition): readonly FormFilterOperator[] {
  if (field.kind === "date") return ["equals", "before", "after", "between", "isEmpty", "isNotEmpty"];
  if (field.kind === "number") return ["equals", "greaterThan", "lessThan", "between", "isEmpty", "isNotEmpty"];
  if (field.kind === "text") return ["contains", "equals", "notEquals", "isEmpty", "isNotEmpty"];
  if (field.kind === "user") return ["equals", "notEquals", "isEmpty", "isNotEmpty"];
  if (field.kind === "select") return ["equals", "notEquals", "isEmpty", "isNotEmpty"];
  return ["equals"];
}

function customDefinition(field: FormsFilterCustomField): FilterDefinition {
  const kind: FilterKind = field.fieldType === "date" ? "date"
    : field.fieldType === "number" ? "number"
      : field.fieldType === "select" || field.fieldType === "radio" ? "select" : "text";
  return {
    value: `custom:${field.id}`,
    label: field.label,
    kind,
    options: kind === "select" ? field.options.map((value) => ({ value, label: value })) : undefined,
    finance: field.section === "finance",
    contact: field.section === "customer",
  };
}

function newCondition(): FormFilterCondition {
  return { field: "urgent", operator: "equals", value: "true" };
}

function normalizedForField(field: FilterDefinition, people: readonly FilterOption[]): FormFilterCondition {
  if (field.kind === "date") return { field: field.value, operator: "equals", value: new Date().toISOString().slice(0, 10) };
  const first = (field.kind === "user" ? people : field.options)?.[0]?.value ?? "";
  return { field: field.value, operator: field.kind === "text" ? "contains" : "equals", value: first };
}

export function FormsFilterBuilder({
  conditions,
  match,
  canViewFinance,
  canViewCustomerContact = false,
  canViewPaymentProof = false,
  people = [],
  customFields = [],
  preset = "all",
  onPresetChange,
  savedSearches,
  onApply,
}: Readonly<{
  conditions: readonly FormFilterCondition[];
  match: "and" | "or";
  canViewFinance: boolean;
  canViewCustomerContact?: boolean;
  canViewPaymentProof?: boolean;
  people?: readonly Readonly<{ id: string; name: string }>[];
  customFields?: readonly FormsFilterCustomField[];
  preset?: "all" | "lastSixMonths" | "lastYear";
  onPresetChange?: (preset: "all" | "lastSixMonths" | "lastYear") => void;
  savedSearches?: ReactNode;
  onApply: (group: FormFilterGroup) => void;
}>) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const matchRef = useRef<HTMLSelectElement>(null);
  const [open, setOpen] = useState(false);
  const [draftMatch, setDraftMatch] = useState<"and" | "or">(match);
  const [draft, setDraft] = useState<readonly FormFilterCondition[]>(conditions.length ? conditions : [newCondition()]);
  const peopleOptions = people.map((person) => ({ value: person.id, label: person.name }));
  const availableFields = [...baseFields, ...customFields.map(customDefinition)].filter((field) =>
    (canViewFinance || !field.finance) &&
    (canViewCustomerContact || !field.contact) &&
    (canViewPaymentProof || !field.paymentProof)
  );

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
    const ready = draft.filter((condition) => condition.operator === "isEmpty" || condition.operator === "isNotEmpty" ||
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
              const definition = availableFields.find((field) => field.value === condition.field) ?? availableFields[0] ?? baseFields[0];
              const options = definition.kind === "user" ? peopleOptions : definition.options;
              const isBetween = condition.operator === "between";
              const isNoValue = condition.operator === "isEmpty" || condition.operator === "isNotEmpty";
              const values = typeof condition.value === "string" ? [condition.value] : condition.value;
              return (
                <div className={styles.filterRow} key={`${index}-${condition.field}`}>
                  <select
                    aria-label={`Filter field ${index + 1}`}
                    value={condition.field}
                    onChange={(event) => {
                      const next = availableFields.find((field) => field.value === event.target.value) ?? availableFields[0] ?? baseFields[0];
                      update(index, normalizedForField(next, peopleOptions));
                    }}
                  >
                    {availableFields.map((field) => (
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
                    {operatorsFor(definition).map((operator) => <option key={operator} value={operator}>{operatorLabels[operator]}</option>)}
                  </select>
                  {isNoValue ? <span className={styles.filterNoValue}>No value needed</span> : options ? (
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
                        type={definition.kind === "date" ? "date" : definition.kind === "number" ? "number" : "text"}
                        step={definition.kind === "number" ? "0.01" : undefined}
                        value={values[0] ?? ""}
                        onChange={(event) => update(index, { ...condition, value: isBetween ? [event.target.value, values[1] ?? ""] : event.target.value })}
                      />
                      {isBetween ? <input
                        aria-label={`Filter end value ${index + 1}`}
                        type={definition.kind === "date" ? "date" : "number"}
                        step={definition.kind === "number" ? "0.01" : undefined}
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
          <section className={styles.savedSearchWorkspace} aria-labelledby="saved-searches-heading">
            <h3 id="saved-searches-heading" className={styles.filterGroupTitle}>Saved searches</h3>
            <div className={styles.filterPresetButtons}>
              {([
                ["all", "All data"],
                ["lastSixMonths", "Last 6 months"],
                ["lastYear", "Last year"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={preset === value}
                  onClick={() => onPresetChange?.(value)}
                >{label}</button>
              ))}
            </div>
            {savedSearches}
          </section>
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
