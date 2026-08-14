"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProductionSavedView } from "@/server/production/production-saved-view-service";
import styles from "./admin.module.css";

export function ProductionSavedViews({ views, currentQuery }: Readonly<{
  views: readonly ProductionSavedView[];
  currentQuery: string;
}>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setFeedback("");
    try {
      const response = await fetch("/api/admin/jobs/views", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: String(form.get("name") ?? ""), queryString: currentQuery }),
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "The view could not be saved.");
      event.currentTarget.reset();
      setFeedback("View saved.");
      router.refresh();
    } catch (error) { setFeedback(error instanceof Error ? error.message : "The view could not be saved."); }
    finally { setPending(false); }
  }

  async function remove(viewId: string) {
    setPending(true);
    setFeedback("");
    try {
      const response = await fetch(`/api/admin/jobs/views/${viewId}`, { method: "DELETE", headers: { "Content-Type": "application/json" } });
      if (!response.ok) throw new Error("The view could not be deleted.");
      router.refresh();
    } catch (error) { setFeedback(error instanceof Error ? error.message : "The view could not be deleted."); }
    finally { setPending(false); }
  }

  return (
    <section className={styles.savedViews} aria-label="Saved production views">
      <div><strong>Saved views</strong>{views.length ? views.map((view) => <span key={view.id}><Link href={`/admin/jobs?${view.queryString}`}>{view.name}</Link><button type="button" onClick={() => void remove(view.id)} disabled={pending} aria-label={`Delete ${view.name}`}>×</button></span>) : <small>No saved views</small>}</div>
      {currentQuery ? <form onSubmit={save}><label><span className={styles.visuallyHidden}>View name</span><input name="name" placeholder="Name current filters" maxLength={80} required disabled={pending} /></label><button type="submit" disabled={pending}>Save current filters</button></form> : null}
      <p aria-live="polite">{feedback}</p>
    </section>
  );
}
