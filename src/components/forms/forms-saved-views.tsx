"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { LuEllipsis, LuPencil, LuTrash2 } from "react-icons/lu";

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
  const [actionsViewId, setActionsViewId] = useState<string | null>(null);
  const actionsId = useId();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const actionsGroupRef = useRef<HTMLDivElement>(null);
  const actionsButtonRef = useRef<HTMLButtonElement>(null);
  const actionsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!actionsViewId) return;
    actionsMenuRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    actionsMenuRef.current?.scrollIntoView?.({ block: "nearest" });

    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !actionsGroupRef.current?.contains(event.target)) {
        setActionsViewId(null);
      }
    }

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      // Close this menu before the containing filter dialog handles Escape.
      event.stopPropagation();
      actionsButtonRef.current?.focus();
      setActionsViewId(null);
    }

    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [actionsViewId]);

  function moveMenuFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])")];
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }

  function beginEdit(view: ProductionSavedView) {
    setEditing(view);
    setName(view.name);
    setMessage(`Editing ${view.name}. Adjust the filters, then save changes.`);
    onEdit?.(view.queryString);
    nameInputRef.current?.focus();
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
        {views.map((view) => <div
          key={view.id}
          className={styles.savedViewItem}
          role="group"
          aria-label={`Saved search ${view.name}`}
          ref={actionsViewId === view.id ? actionsGroupRef : undefined}
          onBlur={(event) => {
            if (actionsViewId === view.id && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setActionsViewId(null);
          }}
        >
          <button type="button" title={view.name} onClick={() => {
            setActionsViewId(null);
            onOpen(view.queryString);
          }}>{view.name}</button>
          <button
            type="button"
            aria-label={`More actions for ${view.name}`}
            aria-haspopup="menu"
            aria-expanded={actionsViewId === view.id}
            aria-controls={actionsViewId === view.id ? `${actionsId}-${view.id}` : undefined}
            ref={actionsViewId === view.id ? actionsButtonRef : undefined}
            disabled={pending}
            onClick={() => setActionsViewId((current) => current === view.id ? null : view.id)}
          ><LuEllipsis aria-hidden="true" /></button>
          {actionsViewId === view.id ? <div
            id={`${actionsId}-${view.id}`}
            className={styles.savedViewMenu}
            role="menu"
            aria-label={`Actions for ${view.name}`}
            ref={actionsMenuRef}
            onKeyDown={moveMenuFocus}
          >
            <button type="button" role="menuitem" aria-label={`Edit ${view.name}`} disabled={pending} onClick={() => {
              setActionsViewId(null);
              beginEdit(view);
            }}><LuPencil aria-hidden="true" />Edit</button>
            <button className={styles.savedViewDeleteButton} type="button" role="menuitem" aria-label={`Delete ${view.name}`} disabled={pending} onClick={() => {
              setActionsViewId(null);
              void remove(view);
            }}><LuTrash2 aria-hidden="true" />Delete</button>
          </div> : null}
        </div>)}
      </div> : null}
      <div className={styles.savedViewControls} role="group" aria-label="Save a search">
        <label>
          <span className={styles.visuallyHidden}>Saved view name</span>
          <input
            ref={nameInputRef}
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
