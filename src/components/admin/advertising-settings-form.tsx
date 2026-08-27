"use client";

import { FormEvent, useRef, useState } from "react";
import { createClientId } from "@/lib/client-id";
import styles from "./admin.module.css";

export function AdvertisingSettingsForm({ initialEnabled }: Readonly<{ initialEnabled: boolean }>) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [savedEnabled, setSavedEnabled] = useState(initialEnabled);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const mutationKey = useRef<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || enabled === savedEnabled) return;
    setPending(true);
    setFeedback("");
    mutationKey.current ??= createClientId();
    try {
      const response = await fetch("/api/admin/content/advertising.meta.enabled", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "publish",
          value: enabled ? "enabled" : "disabled",
          idempotencyKey: mutationKey.current,
        }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error || "Tracking setting could not be saved.");
      setSavedEnabled(enabled);
      mutationKey.current = null;
      setFeedback(`Meta advertising measurement is ${enabled ? "enabled" : "disabled"}.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Tracking setting could not be saved.");
    } finally {
      setPending(false);
    }
  }

  const failed = /(?:could not|failed)/i.test(feedback);
  return (
    <form className={styles.panel} onSubmit={save}>
      <div className={styles.settingsHeading}>
        <div>
          <h2>Meta Pixel</h2>
          <p className={styles.mutedText}>
            Measures public storefront and commerce events for advertising. It does not change campaigns or budgets.
          </p>
        </div>
        <span className={savedEnabled ? styles.enabledBadge : styles.disabledBadge}>
          {savedEnabled ? "Enabled" : "Disabled"}
        </span>
      </div>
      <label>
        <input
          type="checkbox"
          role="switch"
          aria-label="Meta advertising measurement"
          checked={enabled}
          disabled={pending}
          onChange={(event) => {
            setEnabled(event.currentTarget.checked);
            setFeedback("");
            mutationKey.current = null;
          }}
        />{" "}
        Enable Meta advertising measurement in Production
      </label>
      <p className={styles.mutedText}>
        Customer photos, artwork, design instructions, contact details, delivery addresses and payment proofs are excluded.
      </p>
      <div>
        <button
          className={styles.primaryAdminButton}
          type="submit"
          disabled={pending || enabled === savedEnabled}
        >
          {pending ? "Saving…" : "Save tracking setting"}
        </button>
      </div>
      {feedback ? <p className={styles.formFeedback} role={failed ? "alert" : "status"}>{feedback}</p> : null}
    </form>
  );
}
