"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClientId } from "@/lib/client-id";
import styles from "./admin.module.css";

type Availability = "disabled" | "internal_verification" | "live";
type FeatureSnapshot = Readonly<{
  status: Availability;
  readiness: readonly Readonly<{ code: string; label: string; ready: boolean }>[];
  ready: boolean;
  canManage: boolean;
}>;
type Change = Readonly<{ status: Availability; expectedStatus: Availability; idempotencyKey: string; liveVerificationConfirmed?: true }>;
const labels: Record<Availability, string> = { disabled: "Disabled", internal_verification: "Internal verification", live: "Live" };
const descriptions: Record<Availability, string> = {
  disabled: "Pay by Bank is hidden from customers and cannot be started.",
  internal_verification: "Available only to authorised administrators in New Zealand checkout, up to NZ$100. Hidden from customers. This uses real bank payments.",
  live: "Pay by Bank is available to eligible New Zealand customers paying in NZD.",
};
const endpoint = "/api/admin/payments/flik-feature";
function isStatus(value: unknown): value is Availability {
  return value === "disabled" || value === "internal_verification" || value === "live";
}
function parseSnapshot(value: unknown): FeatureSnapshot {
  if (!value || typeof value !== "object") throw new Error("Invalid availability");
  const result = value as Partial<FeatureSnapshot>;
  if (!isStatus(result.status) || typeof result.ready !== "boolean" || typeof result.canManage !== "boolean" ||
    !Array.isArray(result.readiness) || !result.readiness.every((item) => item && typeof item.code === "string" &&
      typeof item.label === "string" && typeof item.ready === "boolean") ||
    (result.ready && !result.readiness.every((item) => item.ready))) throw new Error("Invalid availability");
  return result as FeatureSnapshot;
}

export function FlikFeaturePanel() {
  const [snapshot, setSnapshot] = useState<FeatureSnapshot | null>(null);
  const [selected, setSelected] = useState<Availability>("disabled");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [liveConfirmed, setLiveConfirmed] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const change = useRef<Change | null>(null);
  const requestInFlight = useRef(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    void fetch(endpoint, { method: "GET", cache: "no-store", headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unavailable");
        const result = parseSnapshot(await response.json());
        if (!active) return;
        setSnapshot(result);
        setSelected(result.status);
        setLiveConfirmed(false);
        change.current = null;
        setUncertain(false);
        setError("");
      }).catch(() => {
        if (!active) return;
        setSnapshot(null);
        setError("Availability could not be checked. Controls are disabled until the current status can be confirmed.");
      }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshKey]);

  async function save() {
    if (!snapshot?.canManage || loading || requestInFlight.current ||
      (selected !== "disabled" && !snapshot.ready) ||
      (selected === "live" && (snapshot.status === "disabled" || !liveConfirmed)) ||
      (selected === snapshot.status && !uncertain)) return;
    requestInFlight.current = true;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      change.current ??= { status: selected, expectedStatus: snapshot.status, idempotencyKey: createClientId(),
        ...(selected === "live" ? { liveVerificationConfirmed: true as const } : {}) };
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(change.current),
      });
      if (!response.ok) throw new Error("Unconfirmed change");
      const result = parseSnapshot(await response.json());
      setSnapshot(result);
      setSelected(result.status);
      setLiveConfirmed(false);
      change.current = null;
      setUncertain(false);
      setMessage("Availability saved.");
    } catch {
      setUncertain(true);
      setError("The change could not be confirmed. Retry the same save or refresh the current status before making another change.");
    } finally {
      requestInFlight.current = false;
      setSaving(false);
    }
  }

  return <section className={styles.panel} aria-labelledby="flik-feature-heading">
    <h2 id="flik-feature-heading">Flik Pay by Bank</h2>
    <p>New Zealand bank payments only. Once setup is complete, the owner can change availability here without another deployment.</p>
    {loading ? <p role="status">Checking availability…</p> : null}
    {snapshot ? <>
      <p><strong>Current availability: {labels[snapshot.status]}</strong></p>
      <p>{descriptions[snapshot.status]}</p>
      <h3>Readiness</h3>
      <dl className={styles.stackedDefinitionList} aria-label="Pay by Bank readiness">
        {snapshot.readiness.map((item) => <div key={item.code}><dt>{item.label}</dt><dd>{item.ready ? "Ready" : "Missing"}</dd></div>)}
      </dl>
      {!snapshot.ready ? <p>Complete the missing requirements before enabling internal verification or live availability.</p> : null}
      {snapshot.canManage ? <form className={styles.compactForm} onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label>Availability<select value={selected} disabled={loading || saving || uncertain} onChange={(event) => {
          if (isStatus(event.target.value)) setSelected(event.target.value);
          setLiveConfirmed(false);
          setMessage("");
        }}>
          <option value="disabled">Disabled</option>
          <option value="internal_verification" disabled={!snapshot.ready}>Internal verification</option>
          <option value="live" disabled={!snapshot.ready || snapshot.status === "disabled"}>Live</option>
        </select></label>
        {selected !== snapshot.status ? <p>After saving: {descriptions[selected]}</p> : null}
        {snapshot.status === "disabled" ? <p>Complete internal verification before choosing Live.</p> : null}
        {selected === "live" && snapshot.status !== "live" ? <label className={styles.checkboxField}>
          <input type="checkbox" checked={liveConfirmed} disabled={saving || uncertain} onChange={(event) => setLiveConfirmed(event.target.checked)} />
          <span>I have verified the live payment, webhook, order status, NZD amount and duplicate handling.</span>
        </label> : null}
        <button className={styles.primaryAdminButton} type="submit" disabled={loading || saving ||
          (!uncertain && selected === snapshot.status) || (selected !== "disabled" && !snapshot.ready) ||
          (selected === "live" && (snapshot.status === "disabled" || !liveConfirmed))}>
          {saving ? "Saving…" : uncertain ? "Retry save" : "Save availability"}
        </button>
      </form> : <p>Only the owner can change availability.</p>}
    </> : null}
    {message ? <p role="status">{message}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <div className={styles.headerActions}>
      <button className={styles.secondaryAdminButton} type="button" disabled={loading || saving} onClick={() => {
        setLoading(true); setMessage(""); setRefreshKey((key) => key + 1);
      }}>Refresh status</button>
      {snapshot?.status === "internal_verification" && snapshot.ready
        ? <Link className={styles.secondaryAdminButton} href="/checkout">Open verification checkout</Link> : null}
      <Link className={styles.secondaryAdminButton} href="/admin/settings/payment/flik">Open isolated Flik test</Link>
    </div>
  </section>;
}
