"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import styles from "./storefront.module.css";

type SignOutResult = {
  error?: { message?: string } | null;
};

export type SignOutClient = {
  signOut: () => Promise<SignOutResult>;
};

type AccountSignOutProps = {
  client?: SignOutClient;
};

const fallbackError = "We could not sign you out. Please try again.";

export function AccountSignOut({
  client = authClient,
}: AccountSignOutProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    setError(null);
    setIsPending(true);

    try {
      const response = await client.signOut();
      if (response.error) {
        setError(response.error.message ?? fallbackError);
        return;
      }

      router.replace("/account/sign-in");
    } catch {
      setError(fallbackError);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className={styles.accountSignOut}>
      <button
        className={styles.secondaryButton}
        disabled={isPending}
        onClick={handleSignOut}
        type="button"
      >
        {isPending ? "Signing out…" : "Sign out"}
      </button>
      {error ? (
        <p aria-live="polite" className={styles.formError}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
