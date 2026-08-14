"use client";

import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import styles from "./forms.module.css";

type SignOutClient = Readonly<{
  signOut: () => Promise<{ error?: { message?: string } | null }>;
}>;

export function FormsSignOut({
  client = authClient,
}: Readonly<{ client?: SignOutClient }>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function signOut() {
    setPending(true);
    setError("");
    try {
      const result = await client.signOut();
      if (result.error) {
        setError(result.error.message ?? "We could not sign you out.");
        return;
      }
      window.location.replace("/order-system/sign-in");
    } catch {
      setError("We could not sign you out.");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className={styles.signOutControl}>
      <button disabled={pending} onClick={signOut} type="button">
        {pending ? "Signing out…" : "Log out"}
      </button>
      {error ? <span aria-live="polite">{error}</span> : null}
    </span>
  );
}
