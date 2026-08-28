"use client";

import { useState } from "react";

import type { ProductionSavedView } from "@/server/production/production-saved-view-service";
import styles from "./forms.module.css";

export function FormsSavedViews({
  views,
  currentQuery,
  onOpen,
  onEdit,
  onChanged,
}: Readonly<{
  views: readonly ProductionSavedView[];
  currentQuery: string;
  onOpen: (queryString: string) => void;
  onEdit?: (queryString: string) => void;
  onChanged: () => void;
}>) {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<ProductionSavedView | null>(null);

  function beginEdit(view: ProductionSavedView) {
    setEditing(view);
    setName(view.name);
    setMessage(`Editing ${view.name}. Adjust the filters, then save changes.`);
    onEdit?.(view.queryString);
  }

  function cancelEdit() {
    setEditing(null);
    setName("");
    setMessage("");
  }

  function queryForUpdate(view: ProductionSavedView) {
    const original = new URLSearchParams(view.queryString);
    const current = new URLSearchParams(currentQuery);
    original.delete("match");
    original.delete("filter");
    const match = current.get("match");
    if (match) original.set("match", match);
    for (const filter of current.getAll("filter")) original.append("filter", filter);
    return original.toString();
  }

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

  async function update() {
    if (!editing || !name.trim() || !currentQuery) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/forms/views/${encodeURIComponent(editing.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), queryString: queryForUpdate(editing) }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The view could not be updated.");
      setEditing(null);
      setName("");
      setMessage("View updated.");
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The view could not be updated.");
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
      if (editing?.id === view.id) cancelEdit();
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
          <button type="button" aria-label={`Edit ${view.name}`} disabled={pending} onClick={() => beginEdit(view)}>✎</button>
          <button className={styles.savedViewDeleteButton} type="button" aria-label={`Delete ${view.name}`} disabled={pending} onClick={() => void remove(view)}>×</button>
        </span>)}
      </div> : null}
      <div className={styles.savedViewControls} role="group" aria-label="Save a search">
        <label>
          <span className={styles.visuallyHidden}>Saved view name</span>
          <input
            aria-label="Saved view name"
            value={name}
            maxLength={80}
            placeholder="Saved filter name"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {editing ? <>
          <button type="button" aria-label="Update saved view" disabled={pending || !name.trim() || !currentQuery} onClick={() => void update()}>Save changes</button>
          <button type="button" aria-label="Cancel editing saved view" disabled={pending} onClick={cancelEdit}>Cancel</button>
        </> : <button type="button" aria-label="Save current view" disabled={pending || !name.trim() || !currentQuery} onClick={() => void save()}>Save search</button>}
        <span className={styles.savedViewMessage} role="status">{message}</span>
      </div>
    </div>
  );
}
