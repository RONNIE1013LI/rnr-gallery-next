"use client";

import { FormEvent, useState } from "react";
import { createClientId } from "@/lib/client-id";
import styles from "./admin.module.css";

export type AdminContentEntry = Readonly<{
  key: string;
  group: string;
  label: string;
  description: string;
  maxLength: number;
  multiline: boolean;
  defaultValue: string;
  draftValue: string;
  publishedValue: string;
  updatedAt: Date | null;
  updatedByEmail: string | null;
}>;

function ContentEditor({ entry, canPublish }: Readonly<{
  entry: AdminContentEntry;
  canPublish: boolean;
}>) {
  const [value, setValue] = useState(entry.draftValue);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function mutate(action: "save" | "publish") {
    if (action === "publish" && !window.confirm("Publish this text to the storefront now?")) return;
    setPending(true);
    setFeedback("");
    try {
      const response = await fetch(`/api/admin/content/${encodeURIComponent(entry.key)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, value, idempotencyKey: createClientId() }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error || "Content could not be saved.");
      setFeedback(action === "publish" ? "Published." : "Draft saved.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Content could not be saved.");
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
      {entry.multiline ? <textarea {...fieldProps} rows={5} /> : <input {...fieldProps} />}
      <div className={styles.contentMeta}>
        <span>{value.length} / {entry.maxLength}</span>
        <span>{entry.updatedAt ? `Last draft: ${entry.updatedByEmail ?? "Unknown administrator"}` : "Using code default"}</span>
      </div>
      <details className={styles.contentPreview}>
        <summary>Preview text</summary>
        <p>{value}</p>
      </details>
      <p className={styles.liveValue}>Live: {entry.publishedValue}</p>
      <div className={styles.contentActions}>
        <button type="submit" disabled={pending}>Save draft</button>
        {canPublish ? <button type="button" disabled={pending} onClick={() => void mutate("publish")}>Publish</button> : null}
        <span aria-live="polite">{feedback}</span>
      </div>
    </form>
  );
}

export function AdminContentForm({ entries, canPublish }: Readonly<{
  entries: readonly AdminContentEntry[];
  canPublish: boolean;
}>) {
  const groups = [...new Set(entries.map((entry) => entry.group))];
  if (!groups.length) return <p className={styles.emptyState}>No content fields are configured.</p>;
  return (
    <div className={styles.contentGroups}>
      {groups.map((group) => (
        <section key={group} className={styles.contentGroup}>
          <h2>{group}</h2>
          <div>{entries.filter((entry) => entry.group === group).map((entry) => (
            <ContentEditor key={entry.key} entry={entry} canPublish={canPublish} />
          ))}</div>
        </section>
      ))}
    </div>
  );
}
