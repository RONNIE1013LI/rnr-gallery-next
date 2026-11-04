"use client";

import { FormEvent, useRef, useState } from "react";
import { createClientId } from "@/lib/client-id";
import styles from "./admin.module.css";

export function PromotionSettingsForm({ initialEnabled }: Readonly<{ initialEnabled: boolean }>) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [savedEnabled, setSavedEnabled] = useState(initialEnabled);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; failed: boolean } | null>(null);
  const saving = useRef(false);
  const mutationKey = useRef<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || enabled === savedEnabled) return;
    saving.current = true;
    setPending(true);
    setFeedback(null);
    mutationKey.current ??= createClientId();
    try {
      const response = await fetch("/api/admin/content/promotions.thank_you.enabled", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "publish",
          value: enabled ? "enabled" : "disabled",
          idempotencyKey: mutationKey.current,
        }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error || "Promotion setting could not be saved.");
      setSavedEnabled(enabled);
      mutationKey.current = null;
      setFeedback({ message: `Promotion setting saved: ${enabled ? "enabled" : "disabled"}.`, failed: false });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Promotion setting could not be saved.",
        failed: true,
      });
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  return (
    <form className={styles.panel} onSubmit={save}>
      <div className={styles.settingsHeading}>
        <div>
          <h2>Anniversary promotion</h2>
          <p className={styles.mutedText}>Master switch for the thank-you offer campaign.</p>
        </div>
        <span className={savedEnabled ? styles.enabledBadge : styles.disabledBadge}>
          {savedEnabled ? "Enabled" : "Disabled"}
        </span>
      </div>
      <label>
        <input
          type="checkbox"
          role="switch"
          aria-label="Anniversary promotion"
          checked={enabled}
          disabled={pending}
          onChange={(event) => {
            if (saving.current) return;
            setEnabled(event.currentTarget.checked);
            setFeedback(null);
            mutationKey.current = null;
          }}
        />{" "}
        Enable anniversary promotion
      </label>
      <p className={styles.mutedText}>
        When disabled, the homepage and product promotion popups are hidden, automatic 20% discounts on new orders stop,
        new promotional voucher issuance and redemption stop, and the order system’s Generate voucher button is hidden.
      </p>
      <p className={styles.mutedText}>
        Submitted orders and their payment amounts are retained. The cart voucher field stays available.
        While enabled, the base 20% discount and valid account-bound returning vouchers can be used on multiple orders.
      </p>
      <p className={styles.mutedText}>After saving, refresh any already-open storefront or order-system pages to see the updated display.</p>
      <div>
        <button className={styles.primaryAdminButton} type="submit" disabled={pending || enabled === savedEnabled}>
          {pending ? "Saving…" : "Save promotion setting"}
        </button>
      </div>
      {feedback ? <p className={styles.formFeedback} role={feedback.failed ? "alert" : "status"}>{feedback.message}</p> : null}
    </form>
  );
}
