const MINIMUM_SECRET_LENGTH = 32;
const MINIMUM_SECRET_ENTROPY_BITS = 120;
const LOCAL_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type AuthConfig = Readonly<{
  baseURL: string;
  origin: string;
  secret: string;
}>;

type AuthEnvironment = Readonly<Record<string, string | undefined>>;

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
    (!allowsLocalHTTP || !LOCAL_HTTP_HOSTS.has(url.hostname))
  ) {
    throw new Error(
      "BETTER_AUTH_URL may use HTTP only on localhost in development or test",
    );
  }

  return Object.freeze({
    baseURL: url.origin,
    origin: url.origin,
    secret,
  });
}
