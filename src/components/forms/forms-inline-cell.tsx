"use client";

import type { ReactNode } from "react";
import { useState } from "react";

import type { FormInlineFieldKey } from "@/domain/forms/forms-parity";
import { formsStatusKey } from "./forms-format";
import styles from "./forms.module.css";

type InlineKind = "text" | "date" | "select" | "boolean" | "money";
type InlineValue = string | number | boolean | null;

function inputValue(value: InlineValue, kind: InlineKind) {
  if (kind === "boolean") return value ? "true" : "false";
  if (kind === "money") return (Number(value ?? 0) / 100).toFixed(2);
  return String(value ?? "");
}

function requestValue(value: string, kind: InlineKind): InlineValue {
  if (kind === "boolean") return value === "true";
  if (kind === "money") return Math.round(Number(value) * 100);
  return value;
}

function idempotencyKey(jobId: string, field: string) {
  const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `inline-${jobId}-${field}-${nonce}`.slice(0, 255);
}

export function FormsInlineCell({
  jobId,
  reference,
  field,
  label,
  value,
  version,
  kind,
  options = [],
  children,
  onSaved,
  onReload,
}: Readonly<{
  jobId: string;
  reference: string;
  field: FormInlineFieldKey;
  label: string;
  value: InlineValue;
  version: string;
  kind: InlineKind;
  options?: readonly Readonly<{ value: string; label: string }>[];
  children?: ReactNode;
  onSaved: (version?: string) => void;
  onReload?: () => void;
}>) {
  const original = inputValue(value, kind);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(original);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const [editorWidth, setEditorWidth] = useState<number | null>(null);
  const autosaves = kind === "select" || kind === "boolean";
  const draftStatus = kind === "boolean" ? (draft === "true" ? "yes" : "no") : formsStatusKey(draft);

  async function save(nextDraft = draft) {
    setPending(true);
    setMessage("Saving…");
    setConflict(false);
    try {
      const response = await fetch(`/api/forms/jobs/${encodeURIComponent(jobId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field,
          value: requestValue(nextDraft, kind),
          expectedUpdatedAt: version,
          idempotencyKey: idempotencyKey(jobId, field),
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; version?: string };
      if (!response.ok) {
        setConflict(response.status === 409);
        throw new Error(payload.error ?? "The value could not be saved.");
      }
      setEditing(false);
      setMessage("");
      onSaved(payload.version);
    } catch (error) {
      setDraft(original);
      setEditing(false);
      setMessage(error instanceof Error ? error.message : "The value could not be saved.");
    } finally {
      setPending(false);
    }
  }

  if (!editing) {
    return (
      <span className={styles.inlineCell}>
        <button
          className={styles.inlineValue}
          type="button"
          aria-label={`Edit ${label} for ${reference}`}
          onClick={(event) => {
            setDraft(original);
            setMessage("");
            setConflict(false);
            setEditorWidth(autosaves ? event.currentTarget.getBoundingClientRect().width : null);
            setEditing(true);
          }}
        >
          {children ?? (original || "—")}
        </button>
        {message ? <small role="status" data-error="true">{message}</small> : null}
        {conflict ? <button type="button" className={styles.inlineReload} onClick={onReload}>Reload row</button> : null}
      </span>
    );
  }

  return (
    <span className={styles.inlineEditor} style={editorWidth ? { width: `${editorWidth}px` } : undefined}>
      {kind === "select" || kind === "boolean" ? (
        <select
          aria-label={`${label} for ${reference}`}
          value={draft}
          disabled={pending}
          data-field={field}
          data-status={draftStatus}
          onChange={(event) => {
            const nextDraft = event.target.value;
            setDraft(nextDraft);
            if (nextDraft === original) {
              setEditing(false);
              return;
            }
            void save(nextDraft);
          }}
        >
          {(kind === "boolean" ? [{ value: "true", label: "YES" }, { value: "false", label: "NO" }] : options)
            .map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
        </select>
      ) : (
        <input
          aria-label={`${label} for ${reference}`}
          value={draft}
          disabled={pending}
          type={kind === "date" ? "date" : kind === "money" ? "number" : "text"}
          step={kind === "money" ? "0.01" : undefined}
          min={kind === "money" ? "0" : undefined}
          onChange={(event) => setDraft(event.target.value)}
        />
      )}
      {!autosaves ? <>
        <button type="button" disabled={pending || !draft} aria-label={`Save ${label}`} onClick={() => void save()}>✓</button>
        <button type="button" disabled={pending} aria-label={`Cancel ${label}`} onClick={() => { setDraft(original); setEditing(false); }}>×</button>
      </> : null}
      {message ? <small role="status">{message}</small> : null}
    </span>
  );
}
