"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClientId } from "@/lib/client-id";
import styles from "./admin.module.css";

export type ProductionFieldView = Readonly<{
  id: string;
  fieldKey: string;
  label: string;
  fieldType: string;
  section: string;
  options: readonly string[];
  required: boolean;
  enabled: boolean;
  showOnCreate: boolean;
  showOnDetail: boolean;
  showOnList: boolean;
  legacyOnly: boolean;
  sortOrder: number;
  updatedAt: string;
}>;

const fieldTypes = ["text", "textarea", "number", "date", "select", "radio", "file"];
const sections = ["order", "product", "payment", "delivery", "customer", "design", "production", "finance", "legacy"];

function payload(form: FormData) {
  const fieldType = String(form.get("fieldType") ?? "text");
  return {
    label: String(form.get("label") ?? ""),
    fieldType,
    section: String(form.get("section") ?? "order"),
    options: fieldType === "select" || fieldType === "radio"
      ? String(form.get("options") ?? "").split(/\r?\n|,/).map((option) => option.trim()).filter(Boolean)
      : [],
    required: form.get("required") === "on",
    enabled: form.get("enabled") === "on",
    showOnCreate: form.get("showOnCreate") === "on",
    showOnDetail: form.get("showOnDetail") === "on",
    showOnList: form.get("showOnList") === "on",
    legacyOnly: form.get("legacyOnly") === "on",
    sortOrder: Number(form.get("sortOrder") ?? 0),
  };
}

function FieldSettings({ field, disabled }: Readonly<{ field?: ProductionFieldView; disabled: boolean }>) {
  return <>
    <label><span>Label</span><input name="label" defaultValue={field?.label ?? ""} required maxLength={190} disabled={disabled} /></label>
    <label><span>Type</span><select name="fieldType" defaultValue={field?.fieldType ?? "text"} disabled={disabled}>{fieldTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
    <label><span>Section</span><select name="section" defaultValue={field?.section ?? "order"} disabled={disabled}>{sections.map((section) => <option key={section} value={section}>{section}</option>)}</select></label>
    <label><span>Sort order</span><input name="sortOrder" type="number" min="-10000" max="10000" defaultValue={field?.sortOrder ?? 0} disabled={disabled} /></label>
    <label className={styles.fullField}><span>Options (one per line, select/radio only)</span><textarea name="options" rows={3} defaultValue={field?.options.join("\n") ?? ""} disabled={disabled} /></label>
    <div className={`${styles.fullField} ${styles.fieldVisibilityGrid}`}>
      {([
        ["required", "Required", field?.required ?? false],
        ["enabled", "Enabled", field?.enabled ?? true],
        ["showOnCreate", "Show on create", field?.showOnCreate ?? false],
        ["showOnDetail", "Show on detail", field?.showOnDetail ?? true],
        ["showOnList", "Show on list", field?.showOnList ?? false],
        ["legacyOnly", "Legacy only", field?.legacyOnly ?? false],
      ] as const).map(([name, label, checked]) => <label className={styles.checkboxField} key={name}><input name={name} type="checkbox" defaultChecked={checked} disabled={disabled} /><span>{label}</span></label>)}
    </div>
  </>;
}

export function ProductionFieldManager({ fields }: Readonly<{ fields: readonly ProductionFieldView[] }>) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");

  async function mutate(method: "POST" | "PATCH", body: Record<string, unknown>, key: string) {
    setPending(key);
    setFeedback("");
    try {
      const response = await fetch("/api/admin/jobs/fields", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "The field could not be saved.");
      setFeedback("Field settings saved.");
      router.refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "The field could not be saved.");
    } finally {
      setPending(null);
    }
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void mutate("POST", {
      ...payload(form),
      idempotencyKey: createClientId(),
      fieldKey: String(form.get("fieldKey") ?? ""),
    }, "new");
  }

  function update(event: FormEvent<HTMLFormElement>, field: ProductionFieldView) {
    event.preventDefault();
    void mutate("PATCH", {
      ...payload(new FormData(event.currentTarget)),
      fieldId: field.id,
      expectedUpdatedAt: field.updatedAt,
      idempotencyKey: createClientId(),
    }, field.id);
  }

  return <div className={styles.fieldManager}>
    <section className={styles.formPanel}>
      <div className={styles.formSectionHeading}><div><span>+</span><h2>Add custom field</h2></div><p>Use typed fields for workflow logic. Custom fields are for additional studio information.</p></div>
      <form className={styles.formGrid} onSubmit={create}>
        <label><span>Field key</span><input name="fieldKey" pattern="[a-z][a-z0-9_]{1,63}" placeholder="event_venue" required disabled={pending !== null} /></label>
        <FieldSettings disabled={pending !== null} />
        <button className={styles.primaryAdminButton} type="submit" disabled={pending !== null}>{pending === "new" ? "Adding…" : "Add field"}</button>
      </form>
    </section>

    <div className={styles.fieldDefinitionList}>
      {fields.map((field) => <details className={styles.formPanel} key={field.id} open={fields.length <= 3}>
        <summary><span><strong>{field.label}</strong><small>{field.fieldKey} · {field.fieldType} · {field.section}</small></span><em>{field.enabled ? "Enabled" : "Disabled"}{field.legacyOnly ? " · Legacy" : ""}</em></summary>
        <form className={styles.formGrid} onSubmit={(event) => update(event, field)}>
          <label><span>Field key (immutable)</span><input value={field.fieldKey} readOnly /></label>
          <FieldSettings field={field} disabled={pending !== null} />
          <button className={styles.primaryAdminButton} type="submit" disabled={pending !== null}>{pending === field.id ? "Saving…" : "Save field"}</button>
        </form>
      </details>)}
    </div>
    <p className={styles.formFeedback} aria-live="polite">{feedback}</p>
  </div>;
}
