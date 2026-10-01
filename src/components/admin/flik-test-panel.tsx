"use client";

import { useEffect, useRef, useState } from "react";
import type { FlikTestResult } from "@/server/payments/flik-test-service";
import styles from "./admin.module.css";

const messages = {
  created: "The isolated test payment is ready. Continue to Flik to simulate payment.",
  pending: "Payment is awaiting confirmation. Check its status before starting another test.",
  failed: "The last test attempt did not succeed. You can retry the same Flik session.",
  expired: "This test session has expired. Start a new test when ready.",
  completed: "Test payment confirmed. No real money moved and no order was created.",
};
export function FlikTestPanel({ enabled, initialSessionId }: Readonly<{ enabled: boolean; initialSessionId?: string }>) {
  const [session, setSession] = useState<FlikTestResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [attempted, setAttempted] = useState(false);
  const key = useRef(initialSessionId ?? "");
  const confirmedReturn = useRef(false);

  async function submit(action: "create" | "confirm", sessionId?: string) {
    if (!enabled || pending) return;
    setPending(true);
    setAttempted(true);
    setError("");
    try {
      if (!key.current) key.current = crypto.randomUUID();
      const body = action === "create" ? { action, idempotencyKey: key.current } : { action, sessionId: sessionId ?? session?.id ?? key.current };
      const response = await fetch("/api/admin/payments/flik-test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { session?: FlikTestResult; error?: string };
      if (!response.ok || !payload.session) throw new Error(payload.error || "Test payment could not be confirmed. Check again before starting another test.");
      setSession(payload.session);
      key.current = payload.session.id;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Test payment could not be confirmed."); }
    finally { setPending(false); }
  }
  useEffect(() => {
    if (enabled && initialSessionId && !confirmedReturn.current) {
      confirmedReturn.current = true;
      void submit("confirm", initialSessionId);
    }
    // Confirm only the server-validated session ID supplied when returning to this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, initialSessionId]);

  return <section className={styles.panel}>
    <h2>Isolated NZ bank payment test</h2>
    <p>Fixed test amount: NZ$1.00. No real money, customer order, email, production job or Purchase conversion is created.</p>
    {!enabled ? <p role="status">Testing is unavailable. Enable test mode only in the isolated development environment with a dedicated local test database and an HTTPS return origin.</p> : null}
    <div className={styles.headerActions}>
      <button className={styles.primaryAdminButton} disabled={!enabled || pending || Boolean(session && !["expired", "completed"].includes(session.status))} type="button" onClick={() => { if (session) key.current = ""; void submit("create"); }}>{pending ? "Checking…" : "Start NZ$1.00 test"}</button>
      {enabled && (session || initialSessionId || attempted) ? <button className={styles.secondaryAdminButton} disabled={pending} type="button" onClick={() => void submit("confirm")}>Check test status</button> : null}
      {enabled && session?.status === "pending" && !session.redirectUrl ? <button className={styles.secondaryAdminButton} disabled={pending} type="button" onClick={() => void submit("create")}>Recover test session</button> : null}
    </div>
    {session ? <p role="status" aria-live="polite">{messages[session.status]}</p> : null}
    {session?.redirectUrl ? <a className={styles.tableAction} href={session.redirectUrl} rel="noreferrer">Continue to Flik test checkout</a> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
