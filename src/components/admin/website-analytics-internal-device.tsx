"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./admin.module.css";

export function WebsiteAnalyticsInternalDevice({
  initialInternal,
}: Readonly<{ initialInternal: boolean }>) {
  const router = useRouter();
  const [internal, setInternal] = useState(initialInternal);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: boolean) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/analytics/internal-device", {
        method: next ? "POST" : "DELETE",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      if (!response.ok) throw new Error("Internal device request failed");
      setInternal(next);
      router.refresh();
    } catch {
      setError("Device setting could not be changed.");
    } finally {
      setPending(false);
    }
  }

  return <aside className={styles.panel} aria-label="Internal traffic device setting">
    <p>{internal
      ? "This device is marked internal."
      : "This device is not marked internal."}</p>
    <div className={styles.filterActions}>
      <button disabled={pending} type="button" onClick={() => { void change(!internal); }}>
        {internal
          ? "Stop marking this device as internal"
          : "Mark this device as internal"}
      </button>
    </div>
    {error ? <p role="alert">{error}</p> : null}
  </aside>;
}
