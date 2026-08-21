"use client";

import { useState } from "react";

import type { ProductionSavedView } from "@/server/production/production-saved-view-service";
import styles from "./forms.module.css";

export function FormsSavedViews({
  views,
  currentQuery,
  onOpen,
  onChanged,
}: Readonly<{
  views: readonly ProductionSavedView[];
  currentQuery: string;
  onOpen: (queryString: string) => void;
  onChanged: () => void;
}>) {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    if (!name.trim() || !currentQuery) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/forms/views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), queryString: currentQuery }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The view could not be saved.");
      setName("");
      setMessage("View saved.");
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The view could not be saved.");
    } finally {
      setPending(false);
    }
  }

  async function remove(view: ProductionSavedView) {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/forms/views/${encodeURIComponent(view.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The view could not be deleted.");
      setMessage("View deleted.");
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The view could not be deleted.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.personalViews}>
      {views.length ? <div className={styles.personalViewList} aria-label="Personal saved views">
        {views.map((view) => <span key={view.id}>
          <button type="button" onClick={() => onOpen(view.queryString)}>{view.name}</button>
          <button type="button" aria-label={`Delete ${view.name}`} disabled={pending} onClick={() => void remove(view)}>×</button>
        </span>)}
      </div> : null}
      <label>
        <span className={styles.visuallyHidden}>Saved view name</span>
        <input
          aria-label="Saved view name"
          value={name}
          maxLength={80}
          placeholder="View name"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <button type="button" disabled={pending || !name.trim() || !currentQuery} onClick={() => void save()}>Save current view</button>
      <span className={styles.savedViewMessage} role="status">{message}</span>
    </div>
  );
}
