"use client";
import { useEffect, useState } from "react";
import styles from "./admin.module.css";
type Snapshot = { enabled: boolean; autoMatch?: boolean;
  receipts?: { id: string; transactionId: string; digest: string; amountCents: number | null; currency: string; reference: string | null; payerName: string | null; receivedAt: string; reason: string | null; eligible: boolean; status: string; intentId: string | null }[];
  intents?: { intent: { id: string; reference: string; amountCents: number; merchantReference: string } }[];
  audit?: { id: string; actorId: string; action: string; reason: string; createdAt: string }[];
};
const endpoint = "/api/admin/payments/wise-payid";
async function load(): Promise<Snapshot> {
  const response = await fetch(endpoint, { cache: "no-store" });
  if (!response.ok) throw new Error("Wise reconciliation unavailable");
  return response.json();
}
export function WisePayIdPanel() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void load().then((value) => { if (active) setSnapshot(value); }).catch(() => { if (active) setError("Wise reconciliation unavailable"); });
    return () => { active = false; };
  }, []);
  async function submit(body: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Review was not confirmed");
      setSnapshot(await load());
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Review was not confirmed"); }
    finally { setBusy(false); }
  }
  return <>
    {error ? <p role="alert">{error}</p> : null}
    {!snapshot ? <p>Loading reconciliation…</p> : !snapshot.enabled ? <p>Wise PayID is disabled. Configure the server securely after verification and database approval.</p> : <>
      <section className={styles.panel}><h2>Statement reconciliation</h2>
        <p>Automatic confirmation: {snapshot.autoMatch ? "enabled" : "disabled — manual review required"}. Statement checks run at most once per hour.</p>
        <button type="button" disabled={busy} className={styles.primaryAdminButton} onClick={() => void submit({ action: "poll" })}>Check AUD statement</button>
      </section>
      <section className={styles.panel}><h2>Receipts requiring review</h2>
        {!snapshot.receipts?.length ? <p>No receipts require review.</p> : snapshot.receipts.map((receipt) => <section key={receipt.id} className={styles.panel}>
          <h3>{receipt.currency} {receipt.amountCents === null ? "Unknown amount" : (receipt.amountCents / 100).toFixed(2)}</h3>
          <dl><dt>Transaction</dt><dd>{receipt.transactionId}</dd><dt>Reference</dt><dd>{receipt.reference ?? "Missing"}</dd><dt>Payer</dt><dd>{receipt.payerName ?? "Unavailable"}</dd><dt>Received</dt><dd>{receipt.receivedAt}</dd><dt>Review reason</dt><dd>{receipt.reason}</dd></dl>
          <form className={styles.formGrid} onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const action = form.get("action");
            const reason = String(form.get("reason") ?? "");
            if (action === "approve" && form.get("verified") !== "on") { setError("Confirm the receipt and selected order before approving."); return; }
            void submit(action === "ignore" ? { action, receiptId: receipt.id, reason } : { action: "approve", receiptId: receipt.id, intentId: form.get("intentId"), expectedDigest: receipt.digest, reason });
          }}>
            <p><label>Decision <select name="action" disabled={busy} defaultValue={receipt.status === "reserved" ? "approve" : "ignore"}>{receipt.status !== "reserved" ? <option value="ignore">Leave unallocated and record review</option> : null}{receipt.eligible ? <option value="approve">Confirm payment for a matching order</option> : null}</select></label></p>
            <p><label>Pending order <select name="intentId" disabled={busy} defaultValue={receipt.intentId ?? ""}><option value="">Choose an order</option>{snapshot.intents?.filter(({ intent }) => intent.amountCents === receipt.amountCents && receipt.currency === "AUD").map(({ intent }) => <option key={intent.id} value={intent.id}>{intent.merchantReference} · {intent.reference} · AUD {(intent.amountCents / 100).toFixed(2)}</option>)}</select></label></p>
            <p><label>Review note <input name="reason" required minLength={5} maxLength={500} disabled={busy} /></label></p>
            <p><label><input type="checkbox" name="verified" disabled={busy} /> I verified the actual receipt and selected order. Confirming marks the order paid.</label></p>
            <button type="submit" disabled={busy} className={styles.primaryAdminButton}>Save review decision</button>
          </form>
        </section>)}
      </section>
      <section className={styles.panel}><h2>Recent audit history</h2><p>Latest 100 entries. The database retains the full history.</p>
        <ul>{snapshot.audit?.map((entry) => <li key={entry.id}>{entry.createdAt} · {entry.action} · {entry.reason} · {entry.actorId}</li>)}</ul>
      </section>
    </>}
  </>;
}
