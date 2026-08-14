"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import styles from "./storefront.module.css";

type AuthResult = Readonly<{
  error: Readonly<{ code?: string; message?: string }> | null;
}>;

export type PasswordResetClient = Readonly<{
  requestPasswordReset(input: Readonly<{
    email: string;
    redirectTo: string;
  }>): Promise<AuthResult>;
  resetPassword(input: Readonly<{
    newPassword: string;
    token: string;
  }>): Promise<AuthResult>;
}>;

type PasswordResetFormProps = Readonly<{
  mode: "request" | "reset";
  token?: string;
  client?: PasswordResetClient;
}>;

export function PasswordResetForm({
  mode,
  token = "",
  client = authClient as unknown as PasswordResetClient,
}: PasswordResetFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError("");
    if (mode === "reset" && password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }

    setPending(true);
    try {
      const result = mode === "request"
        ? await client.requestPasswordReset({
            email,
            redirectTo: "/account/reset-password",
          })
        : await client.resetPassword({ newPassword: password, token });
      if (result.error) {
        setError(
          result.error.code === "INVALID_TOKEN"
            ? "This reset link is invalid or has expired."
            : result.error.message ?? "We could not complete your request. Please try again.",
        );
        return;
      }
      setComplete(true);
    } catch {
      setError("We could not complete your request. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (complete) {
    return <div className={styles.authForm} aria-live="polite">
      <p>{mode === "request"
        ? "If an account exists for that email, a reset link has been sent. Check your inbox and spam folder."
        : "Your password has been reset."}</p>
      <Link className={styles.primaryButton} href="/account/sign-in">Sign in</Link>
    </div>;
  }

  return <form className={styles.authForm} onSubmit={submit}>
    {mode === "request" ? <label className={styles.formField}>
      <span>Email address</span>
      <input
        autoComplete="email"
        name="email"
        onChange={(event) => setEmail(event.target.value)}
        required
        type="email"
        value={email}
      />
    </label> : <>
      <label className={styles.formField}>
        <span>New password</span>
        <input
          autoComplete="new-password"
          minLength={8}
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>
      <label className={styles.formField}>
        <span>Confirm new password</span>
        <input
          autoComplete="new-password"
          minLength={8}
          name="passwordConfirmation"
          onChange={(event) => setConfirmation(event.target.value)}
          required
          type="password"
          value={confirmation}
        />
      </label>
    </>}
    {error ? <p aria-live="polite" className={styles.formError}>{error}</p> : null}
    <button className={styles.primaryButton} disabled={pending} type="submit">
      {pending
        ? mode === "request" ? "Sending reset link…" : "Resetting password…"
        : mode === "request" ? "Send reset link" : "Reset password"}
    </button>
    <p className={styles.authSwitch}>
      <Link href="/account/sign-in">Back to sign in</Link>
    </p>
  </form>;
}
