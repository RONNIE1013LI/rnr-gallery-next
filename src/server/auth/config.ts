import { isLocalOrPrivateHostname } from "@/server/network/private-hostname";

const MINIMUM_SECRET_LENGTH = 32;
const MINIMUM_SECRET_ENTROPY_BITS = 120;

export type AuthConfig = Readonly<{
  baseURL: string;
  origin: string;
  secret: string;
}>;

type BetterAuthBaseURL =
  | string
  | Readonly<{
      allowedHosts: string[];
      fallback: string;
      protocol: "http";
    }>;

type LocalOAuthProxyOptions = Readonly<{
  productionURL: string;
  secret?: string;
}>;

type AuthEnvironment = Readonly<Record<string, string | undefined>>;

export function getAuthRateLimitOptions() {
  return Object.freeze({
    enabled: true,
    window: 60,
    max: 100,
    storage: "database" as const,
    modelName: "rateLimit" as const,
  });
}

function estimateSecretEntropy(value: string) {
  return value.length * Math.log2(new Set(value).size);
}

function parseAppOrigin(value: string) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error("BETTER_AUTH_URL must be an absolute app origin");
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("BETTER_AUTH_URL must be an absolute app origin");
  }

  return url;
}

export function parseAuthConfig(
  env: AuthEnvironment = process.env,
): AuthConfig {
  const rawURL = env.BETTER_AUTH_URL?.trim();
  if (!rawURL) throw new Error("BETTER_AUTH_URL is required");

  const secret = env.BETTER_AUTH_SECRET?.trim();
  if (
    !secret ||
    secret.length < MINIMUM_SECRET_LENGTH ||
    estimateSecretEntropy(secret) < MINIMUM_SECRET_ENTROPY_BITS
  ) {
    throw new Error(
      "BETTER_AUTH_SECRET must be at least 32 characters with sufficient entropy",
    );
  }

  const url = parseAppOrigin(rawURL);
  if (env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("BETTER_AUTH_URL must use HTTPS in production");
  }
  const allowsLocalHTTP = ["development", "test"].includes(
    env.NODE_ENV ?? "",
  );
  if (
    url.protocol === "http:" &&
    (!allowsLocalHTTP || !isLocalOrPrivateHostname(url.hostname))
  ) {
    throw new Error(
      "BETTER_AUTH_URL may use HTTP only on a local or private network in development or test",
    );
  }

  return Object.freeze({
    baseURL: url.origin,
    origin: url.origin,
    secret,
  });
}

export function getBetterAuthBaseURL(
  config: AuthConfig,
  env: AuthEnvironment = process.env,
): BetterAuthBaseURL {
  if (env.NODE_ENV !== "development") return config.baseURL;

  const configuredHost = new URL(config.baseURL).host;
  return Object.freeze({
    allowedHosts: Array.from(
      new Set([configuredHost, "localhost:3000", "127.0.0.1:3000"]),
    ),
    fallback: config.baseURL,
    protocol: "http" as const,
  });
}

export function getLocalOAuthProxyOptions(
  config: AuthConfig,
  env: AuthEnvironment = process.env,
): LocalOAuthProxyOptions | null {
  if (env.NODE_ENV !== "development") return null;
  const rawProxyURL = env.OAUTH_PROXY_URL?.trim();
  if (!rawProxyURL) return null;

  const proxyURL = parseAppOrigin(rawProxyURL);
  if (proxyURL.protocol !== "https:") {
    throw new Error("OAUTH_PROXY_URL must use HTTPS");
  }

  const secret = env.OAUTH_PROXY_SECRET?.trim();
  return Object.freeze({
    productionURL: proxyURL.origin,
    ...(secret ? { secret } : {}),
  });
}
