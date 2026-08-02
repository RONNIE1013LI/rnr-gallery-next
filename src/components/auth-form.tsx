"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
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
};

export function AuthForm({ mode, client = authClient }: AuthFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isRegistering = mode === "register";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsPending(true);

    try {
      const response = isRegistering
        ? await client.signUp.email({ name, email, password })
        : await client.signIn.email({ email, password });

      if (response.error) {
        setError(response.error.message ?? "We could not complete your request. Please try again.");
        return;
      }

      router.replace("/account");
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
            autoComplete="name"
            name="name"
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
        </label>
      )}
      <label className={styles.formField}>
        <span>Email address</span>
        <input
          autoComplete="email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>
      <label className={styles.formField}>
        <span>Password</span>
        <input
          autoComplete={isRegistering ? "new-password" : "current-password"}
          minLength={8}
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>
      {error && <p aria-live="polite" className={styles.formError}>{error}</p>}
      <button className={styles.primaryButton} disabled={isPending} type="submit">
        {submitLabel}
      </button>
      <p className={styles.authSwitch}>
        {isRegistering ? "Already have an account?" : "New to R&R Gallery?"}{" "}
        <Link href={isRegistering ? "/account/sign-in" : "/account/register"}>
          {isRegistering ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}
