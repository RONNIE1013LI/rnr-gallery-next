"use client";

import Link from "next/link";
import { useState } from "react";
import { FcGoogle } from "react-icons/fc";
import { SiApple, SiGithub } from "react-icons/si";

import { authClient } from "@/lib/auth-client";
import { safeAuthReturnPath } from "@/server/auth/safe-return-path";
import type { SocialProviderId } from "@/server/auth/social-provider-config";

import { AuthForm } from "./auth-form";
import styles from "./storefront.module.css";

type SocialAuthResult = {
  error?: { message?: string } | null;
} | void;

export type SocialAuthClient = {
  signIn: {
    social: (input: {
      callbackURL: string;
      provider: SocialProviderId;
    }) => Promise<SocialAuthResult>;
  };
};

type AuthGatewayProps = {
  audience?: "customer" | "forms";
  configuredProviders: readonly SocialProviderId[];
  mode: "sign-in" | "register";
  oauthOrigin?: string;
  returnTo?: string;
  showIntro?: boolean;
  socialClient?: SocialAuthClient;
};

const providers = [
  { id: "google", label: "Google", Icon: FcGoogle },
  { id: "github", label: "GitHub", Icon: SiGithub },
  { id: "apple", label: "Apple", Icon: SiApple },
] as const;

export function supportsGoogleOAuthOrigin(origin: string) {
  try {
    const url = new URL(origin);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && [
      "localhost",
      "127.0.0.1",
      "[::1]",
    ].includes(url.hostname);
  } catch {
    return false;
  }
}

export function AuthGateway({
  audience = "customer",
  configuredProviders,
  mode,
  oauthOrigin,
  returnTo = "/account",
  showIntro = true,
  socialClient = authClient as SocialAuthClient,
}: AuthGatewayProps) {
  const [showEmail, setShowEmail] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<SocialProviderId | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const enabledProviders = new Set(configuredProviders);
  const isRegistering = mode === "register";
  const isForms = audience === "forms";
  const destination = safeAuthReturnPath(returnTo, isForms ? "/order-system" : "/account");
  const visibleProviders = providers.filter(({ id }) => enabledProviders.has(id));

  async function handleSocialSignIn(provider: SocialProviderId) {
    if (!enabledProviders.has(provider)) return;
    setError(null);
    if (
      provider === "google" &&
      !supportsGoogleOAuthOrigin(oauthOrigin ?? window.location.origin)
    ) {
      setError(
        "Google sign-in requires the secure deployed site. Continue with Email for local testing.",
      );
      return;
    }
    setPendingProvider(provider);

    try {
      const response = await socialClient.signIn.social({
        callbackURL: destination,
        provider,
      });
      if (response?.error) {
        setError(
          response.error.message ??
            "We could not start this sign-in. Please try another option.",
        );
      }
    } catch {
      setError("We could not start this sign-in. Please try another option.");
    } finally {
      setPendingProvider(null);
    }
  }

  return (
    <>
      {showIntro ? (
        <>
          <p className={styles.eyebrow}>{isForms ? "Forms operator access" : "Customer account"}</p>
          <h1>{isForms ? "Studio workbench." : isRegistering ? "Your account is one step away." : "Welcome back."}</h1>
          <p className={styles.authLead}>
            {isForms
              ? "Sign in with an approved staff account to manage studio orders."
              : isRegistering
              ? "Create an account to keep your orders, addresses and artwork details together."
              : "Sign in to keep your R&R Gallery orders and details together."}
          </p>
        </>
      ) : null}

      {visibleProviders.length > 0 ? (
        <>
          <div className={styles.socialAuthList}>
            {visibleProviders.map(({ id, label, Icon }) => {
              return (
                <button
                  className={styles.socialAuthButton}
                  disabled={pendingProvider !== null}
                  key={id}
                  onClick={() => handleSocialSignIn(id)}
                  type="button"
                >
                  <Icon aria-hidden="true" />
                  <span>
                    {pendingProvider === id ? "Connecting…" : `Continue with ${label}`}
                  </span>
                </button>
              );
            })}
          </div>

          <div className={styles.authDivider} aria-hidden="true">
            <span>Other options</span>
          </div>
        </>
      ) : null}

      <button
        className={styles.emailAuthToggle}
        onClick={() => setShowEmail((visible) => !visible)}
        type="button"
      >
        {showEmail ? "Hide Email" : "Continue with Email"}
        <span aria-hidden="true">→</span>
      </button>

      {showEmail && <AuthForm mode={mode} returnTo={destination} showAccountSwitch={!isForms} />}
      {error && (
        <p aria-live="polite" className={styles.formError}>
          {error}
        </p>
      )}

      <p className={styles.authConsent}>
        By continuing, you agree to our{" "}
        <span className={styles.authLegalLinks}>
          <Link href="/terms">Terms of Service</Link>
          {" "}and <Link href="/privacy">Privacy Policy</Link>.
        </span>
      </p>
    </>
  );
}
