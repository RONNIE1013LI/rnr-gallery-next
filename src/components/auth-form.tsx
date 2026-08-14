"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { safeAuthReturnPath } from "@/server/auth/safe-return-path";
import styles from "./storefront.module.css";

type AuthResult = {
  error: { message?: string } | null;
};

type SignInInput = {
  email: string;
  password: string;
};

type SignUpInput = SignInInput & {
  name: string;
};

export type AuthClient = {
  signIn: { email: (input: SignInInput) => Promise<AuthResult> };
  signUp: { email: (input: SignUpInput) => Promise<AuthResult> };
};

type AuthFormProps = {
  mode: "sign-in" | "register";
  client?: AuthClient;
  returnTo?: string;
  showAccountSwitch?: boolean;
};

export function AuthForm({
  mode,
  client = authClient,
  returnTo = "/account",
  showAccountSwitch = true,
}: AuthFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<"name" | "email" | "password", string>>>({});
  const formId = useId().replaceAll(":", "");
  const isRegistering = mode === "register";
  const destination = safeAuthReturnPath(returnTo, "/account");
  const errorId = `${formId}-auth-error`;

  function clearFieldError(field: "name" | "email" | "password") {
    setError(null);
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function invalidField(
    field: "name" | "email" | "password",
    event: React.InvalidEvent<HTMLInputElement>,
  ) {
    event.preventDefault();
    const input = event.currentTarget;
    const message = field === "name"
      ? "Enter your full name."
      : field === "email"
        ? input.validity.typeMismatch ? "Enter a valid email address." : "Enter your email address."
        : input.validity.tooShort ? "Use at least 8 characters." : "Enter your password.";
    setFieldErrors((current) => ({ ...current, [field]: message }));
  }

  function describedBy(field: "name" | "email" | "password") {
    return [fieldErrors[field] ? `${formId}-${field}-error` : "", error ? errorId : ""]
      .filter(Boolean)
      .join(" ") || undefined;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsPending(true);

    try {
      const response = isRegistering
        ? await client.signUp.email({ name, email, password })
        : await client.signIn.email({ email, password });

      if (response.error) {
        setError(isRegistering
          ? "We could not create this account. Try signing in or use a different email."
          : "Incorrect email or password.");
        return;
      }

      router.replace(destination);
    } catch {
      setError("We could not complete your request. Please try again.");
    } finally {
      setIsPending(false);
    }
  }

  const submitLabel = isPending
    ? isRegistering ? "Creating account…" : "Signing in…"
    : isRegistering ? "Create account" : "Sign in";

  return (
    <form className={styles.authForm} onSubmit={handleSubmit}>
      {isRegistering && (
        <label className={styles.formField}>
          <span>Full name</span>
          <input
            aria-describedby={describedBy("name")}
            aria-invalid={Boolean(fieldErrors.name || error) || undefined}
            autoComplete="name"
            name="name"
            onChange={(event) => { setName(event.target.value); clearFieldError("name"); }}
            onInvalid={(event) => invalidField("name", event)}
            required
            value={name}
          />
          {fieldErrors.name ? <small className={styles.formError} id={`${formId}-name-error`}>{fieldErrors.name}</small> : null}
        </label>
      )}
      <label className={styles.formField}>
        <span>Email address</span>
        <input
          aria-describedby={describedBy("email")}
          aria-invalid={Boolean(fieldErrors.email || error) || undefined}
          autoComplete="email"
          name="email"
          onChange={(event) => { setEmail(event.target.value); clearFieldError("email"); }}
          onInvalid={(event) => invalidField("email", event)}
          required
          type="email"
          value={email}
        />
        {fieldErrors.email ? <small className={styles.formError} id={`${formId}-email-error`}>{fieldErrors.email}</small> : null}
      </label>
      <label className={styles.formField}>
        <span>Password</span>
        <input
          aria-describedby={describedBy("password")}
          aria-invalid={Boolean(fieldErrors.password || error) || undefined}
          autoComplete={isRegistering ? "new-password" : "current-password"}
          minLength={8}
          name="password"
          onChange={(event) => { setPassword(event.target.value); clearFieldError("password"); }}
          onInvalid={(event) => invalidField("password", event)}
          required
          type="password"
          value={password}
        />
        {fieldErrors.password ? <small className={styles.formError} id={`${formId}-password-error`}>{fieldErrors.password}</small> : null}
      </label>
      {!isRegistering ? <p className={styles.authSwitch}>
        <Link href="/account/forgot-password">Forgot password?</Link>
      </p> : null}
      {error && <p aria-live="polite" className={styles.formError} id={errorId}>{error}</p>}
      <button className={styles.primaryButton} disabled={isPending} type="submit">
        {submitLabel}
      </button>
      {showAccountSwitch ? <p className={styles.authSwitch}>
        {isRegistering ? "Already have an account?" : "New to R&R Gallery?"}{" "}
        <Link href={destination === "/account"
          ? isRegistering ? "/account/sign-in" : "/account/register"
          : `${isRegistering ? "/account/sign-in" : "/account/register"}?next=${encodeURIComponent(destination)}`}>
          {isRegistering ? "Sign in" : "Create an account"}
        </Link>
      </p> : null}
    </form>
  );
}
