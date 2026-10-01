export type EnabledFlikConfig = Readonly<{
  enabled: true;
  mode: "test" | "live";
  testMode: boolean;
  deployment: "production" | "preview" | "development";
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
}>;
export type FlikConfig = Readonly<{ enabled: false }> | EnabledFlikConfig;
export type FlikPaymentConfig = FlikConfig;

function isolatedTestDatabase(raw: string | undefined) {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return ["postgres:", "postgresql:"].includes(url.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      /^\/rnr_gallery_test_[a-zA-Z0-9_-]+$/.test(url.pathname) &&
      !["host", "hostaddr", "service"].some((key) => url.searchParams.has(key));
  } catch { return false; }
}

// Invalid Flik configuration must never prevent Stripe or Afterpay from starting.
export function parseFlikConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): FlikConfig {
  const disabled = { enabled: false } as const;
  if (env.ENABLE_FLIK_PAYMENTS?.trim() !== "true") return disabled;
  const mode = env.FLIK_MODE?.trim();
  const clientId = env.FLIK_CLIENT_ID?.trim();
  const clientSecret = env.FLIK_CLIENT_SECRET?.trim();
  const webhookSecret = env.FLIK_WEBHOOK_SECRET?.trim();
  const deployment = env.VERCEL_ENV?.trim() || (
    !env.VERCEL && env.FLIK_DEPLOYMENT_ENV?.trim() === "development" ? "development" : undefined
  );
  if (
    (mode !== "test" && mode !== "live") ||
    (deployment !== "production" && deployment !== "preview" && deployment !== "development") ||
    (mode === "live") !== (deployment === "production") ||
    (mode === "test" && (deployment !== "development" || !isolatedTestDatabase(env.DATABASE_URL))) ||
    !clientId?.startsWith(`flik_${mode}_cid_`) ||
    !clientSecret?.startsWith(`flik_${mode}_sk_`) ||
    !webhookSecret?.startsWith("whsec_") ||
    [clientId, clientSecret, webhookSecret].some((value) => /\s/.test(value))
  ) return disabled;
  return Object.freeze({ enabled: true, mode, testMode: mode === "test", deployment, clientId, clientSecret, webhookSecret });
}
