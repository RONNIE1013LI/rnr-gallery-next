"use client";

import { useState } from "react";

import type { AdminFacebookReviewSettings } from "@/domain/customer-reviews/types";
import styles from "./admin.module.css";

export function FacebookReviewSummaryForm({ settings, canPublish }: Readonly<{
  settings: AdminFacebookReviewSettings;
  canPublish: boolean;
}>) {
  const initial = settings.draft ?? settings.published;
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(formElement: HTMLFormElement, action: "save_draft" | "publish") {
    if (pending) return;
    setPending(true);
    setMessage("");
    const form = new FormData(formElement);
    try {
      const response = await fetch("/api/admin/customer-reviews/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          facebookRating: form.get("facebookRating"),
          facebookRecommendationCount: form.get("facebookRecommendationCount"),
          facebookCountIsApproximate: form.get("facebookCountIsApproximate") === "on",
          facebookReviewsPageUrl: form.get("facebookReviewsPageUrl"),
          facebookLastVerifiedAt: form.get("facebookLastVerifiedAt"),
        }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "Facebook summary could not be saved.");
      setMessage(action === "publish" ? "Facebook summary published." : "Facebook summary draft saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Facebook summary could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return <form className={styles.reviewSummaryForm} onSubmit={(event) => { event.preventDefault(); void submit(event.currentTarget, "save_draft"); }}>
    <div className={styles.panelHeading}><div><h2>Facebook review summary</h2><p className={styles.mutedText}>Manually verified aggregate values only. No Facebook scraping or sync.</p></div>{settings.published ? <span>Published</span> : <span>Not published</span>}</div>
    <div className={styles.formGrid}>
      <label><span>Facebook rating</span><input aria-label="Facebook rating" name="facebookRating" defaultValue={initial?.facebookRating ?? ""} inputMode="decimal" min="0" max="5" step="0.1" type="number" required /></label>
      <label><span>Recommendation count</span><input aria-label="Recommendation count" name="facebookRecommendationCount" defaultValue={initial?.facebookRecommendationCount ?? ""} inputMode="numeric" min="0" step="1" type="number" required /></label>
      <label className={`${styles.fullField} ${styles.checkboxField}`}><input name="facebookCountIsApproximate" type="checkbox" defaultChecked={initial?.facebookCountIsApproximate ?? false} /><span>Display the recommendation count as approximate</span></label>
      <label className={styles.fullField}><span>Facebook reviews page URL</span><input aria-label="Facebook reviews page URL" name="facebookReviewsPageUrl" defaultValue={initial?.facebookReviewsPageUrl ?? ""} type="url" required /></label>
      <label><span>Last verified date</span><input aria-label="Last verified date" name="facebookLastVerifiedAt" defaultValue={initial?.facebookLastVerifiedAt ?? ""} type="date" required /></label>
    </div>
    <div className={styles.reviewLiveSummary} aria-label="Published Facebook summary"><strong>Live value</strong>{settings.published ? <span>{settings.published.facebookRating} / 5 · {settings.published.facebookRecommendationCount}{settings.published.facebookCountIsApproximate ? "+" : ""} recommendations · verified {settings.published.facebookLastVerifiedAt}</span> : <span>Not published</span>}</div>
    <div className={styles.reviewFormActions}>
      <button type="submit" disabled={pending}>Save summary draft</button>
      {canPublish ? <button type="button" disabled={pending} onClick={(event) => void submit(event.currentTarget.form!, "publish")}>Publish summary</button> : null}
      <span role="status">{message}</span>
    </div>
  </form>;
}
