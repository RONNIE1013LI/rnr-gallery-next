"use client";

import { FormEvent, useState } from "react";
import { createClientId } from "@/lib/client-id";
import styles from "./admin.module.css";

export type AdminEmailTemplateEntry = Readonly<{
  key: string;
  surface: "storefront" | "email";
  group: string;
  label: string;
  description: string;
  maxLength: number;
  multiline: boolean;
  defaultValue: string;
  allowedVariables: readonly string[];
  draftValue: string;
  publishedValue: string;
  updatedAt: Date | null;
  updatedByEmail: string | null;
}>;

const sampleVariables = Object.freeze({
  customer_name: "Sample Customer",
  order_number: "RNR-SAMPLE-1001",
  amount: "NZ$264.50",
  tracking_number: "SAMPLE123",
  tracking_carrier: "NZ Post",
});

function preview(value: string) {
  return value.replace(/{{\s*([a-z_]+)\s*}}/g, (placeholder, name: keyof typeof sampleVariables) => (
    sampleVariables[name] ?? placeholder
  ));
}

function EmailTemplateEditor({ entry, canPublish }: Readonly<{
  entry: AdminEmailTemplateEntry;
  canPublish: boolean;
}>) {
  const [value, setValue] = useState(entry.draftValue);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function mutate(action: "save" | "publish") {
    if (action === "publish" && !window.confirm("Publish this email wording now?")) return;
    setPending(true);
    setFeedback("");
    try {
      const response = await fetch(`/api/admin/content/${encodeURIComponent(entry.key)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, value, idempotencyKey: createClientId() }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error || "Email template could not be saved.");
      setFeedback(action === "publish" ? "Published." : "Draft saved.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Email template could not be saved.");
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void mutate("save");
  }

  const fieldProps = {
    name: "value",
    value,
    maxLength: entry.maxLength,
    required: true,
    disabled: pending,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValue(event.target.value),
  };

  return (
    <form className={styles.contentEditor} onSubmit={submit}>
      <div className={styles.contentEditorHeading}>
        <div><h3>{entry.label}</h3><p>{entry.description}</p></div>
        <code>{entry.key}</code>
      </div>
      {entry.allowedVariables.length ? (
        <div className={styles.templateVariables} aria-label="Available variables">
          <span>Available variables:</span>
          {entry.allowedVariables.map((variable) => <code key={variable}>{`{{${variable}}}`}</code>)}
        </div>
      ) : <p className={styles.templateVariables}>No variables are available for this field.</p>}
      {entry.multiline ? <textarea {...fieldProps} rows={7} /> : <input {...fieldProps} />}
      <div className={styles.contentMeta}>
        <span>{value.length} / {entry.maxLength}</span>
        <span>{entry.updatedAt ? `Last draft: ${entry.updatedByEmail ?? "Unknown administrator"}` : "Using code default"}</span>
      </div>
      <div className={styles.contentPreview}>
        <strong>Sample preview</strong>
        <p>{preview(value)}</p>
      </div>
      <p className={styles.liveValue}>Live: {entry.publishedValue}</p>
      <div className={styles.contentActions}>
        <button type="submit" disabled={pending}>Save draft</button>
        {canPublish ? <button type="button" disabled={pending} onClick={() => void mutate("publish")}>Publish</button> : null}
        <span aria-live="polite">{feedback}</span>
      </div>
    </form>
  );
}

export function EmailTemplateForm({ entries, canPublish }: Readonly<{
  entries: readonly AdminEmailTemplateEntry[];
  canPublish: boolean;
}>) {
  const groups = [...new Set(entries.map((entry) => entry.group))];
  if (!groups.length) return <p className={styles.emptyState}>No email templates are configured.</p>;
  return (
    <div className={styles.contentGroups}>
      {groups.map((group) => (
        <section key={group} className={styles.contentGroup}>
          <h2>{group}</h2>
          <div>{entries.filter((entry) => entry.group === group).map((entry) => (
            <EmailTemplateEditor key={entry.key} entry={entry} canPublish={canPublish} />
          ))}</div>
        </section>
      ))}
    </div>
  );
}
