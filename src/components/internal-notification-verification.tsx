"use client";

import { useState } from "react";
import styles from "./internal-notification-verification.module.css";

type VerificationState = "idle" | "pending" | "verified" | "invalid" | "failed";

export function InternalNotificationVerification({ token }: Readonly<{ token: string }>) {
  const [state, setState] = useState<VerificationState>("idle");
  const [message, setMessage] = useState("");

  async function verify() {
    if (state === "pending" || state === "verified") return;
    setState("pending");
    setMessage("");
    try {
      const response = await fetch(
        `/api/notification-email/verify/${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      const body = await response.json().catch(() => null) as {
        result?: string;
        error?: string;
      } | null;
      if (response.ok && body?.result === "verified") {
        setState("verified");
        return;
      }
      if (response.status === 400) {
        setState("invalid");
        setMessage("This verification link is invalid or expired.");
        return;
      }
      setState("failed");
      setMessage("Email verification could not be completed. Please try again.");
    } catch {
      setState("failed");
      setMessage("Email verification could not be completed. Please try again.");
    }
  }

  if (state === "verified") {
    return (
      <main className={styles.page}>
        <section className={styles.card}>
          <p className={styles.eyebrow}>R&amp;R Gallery notifications</p>
          <h1>Email verified</h1>
          <p>This email can now receive the selected internal notifications.</p>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>R&amp;R Gallery notifications</p>
        <h1>Verify notification email</h1>
        <p>Confirm this email before it begins receiving internal business notifications.</p>
        {message ? <p className={styles.feedback} role="alert">{message}</p> : null}
        <button type="button" disabled={state === "pending"} onClick={() => void verify()}>
          {state === "pending" ? "Verifying…" : state === "failed" ? "Try again" : "Verify email"}
        </button>
      </section>
    </main>
  );
}
