import {
  GOOGLE_DATA_MANAGER_OAUTH_SCOPE,
  type GoogleDataManagerTokenProvider,
} from "./google-data-manager-client";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const MAX_CREDENTIAL_LENGTH = 8_192;

type Environment = Readonly<Record<string, string | undefined>>;

export type GoogleDataManagerOAuthCredentials = Readonly<{
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}>;

function credential(value: string | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized && normalized.length <= MAX_CREDENTIAL_LENGTH ? normalized : null;
}

export function parseGoogleDataManagerOAuthCredentials(
  env: Environment,
): GoogleDataManagerOAuthCredentials | null {
  const clientId = credential(env.GOOGLE_DATA_MANAGER_OAUTH_CLIENT_ID);
  const clientSecret = credential(env.GOOGLE_DATA_MANAGER_OAUTH_CLIENT_SECRET);
  const refreshToken = credential(env.GOOGLE_DATA_MANAGER_OAUTH_REFRESH_TOKEN);
  return clientId && clientSecret && refreshToken
    ? Object.freeze({ clientId, clientSecret, refreshToken })
    : null;
}

export function createGoogleDataManagerOAuthTokenProvider(input: Readonly<{
  credentials: GoogleDataManagerOAuthCredentials;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}>): GoogleDataManagerTokenProvider {
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? Date.now;
  const timeoutMs = input.timeoutMs ?? 10_000;
  let cached: Readonly<{ token: string; expiresAt: number }> | null = null;

  async function refresh(scope: string) {
    if (scope !== GOOGLE_DATA_MANAGER_OAUTH_SCOPE) return "";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(TOKEN_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: input.credentials.clientId,
          client_secret: input.credentials.clientSecret,
          refresh_token: input.credentials.refreshToken,
          grant_type: "refresh_token",
        }),
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok || !/^application\/json(?:;|$)/i.test(
        response.headers.get("content-type") ?? "",
      )) return "";
      const body: unknown = await response.json();
      if (!body || typeof body !== "object") return "";
      const accessToken = (body as { access_token?: unknown }).access_token;
      const expiresIn = (body as { expires_in?: unknown }).expires_in;
      if (typeof accessToken !== "string" || !accessToken.trim()
        || typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 60) return "";
      cached = Object.freeze({
        token: accessToken.trim(),
        expiresAt: now() + Math.floor(expiresIn * 1_000),
      });
      return cached.token;
    } catch {
      return "";
    } finally {
      clearTimeout(timeout);
    }
  }

  return Object.freeze({
    async getAccessToken(scope) {
      return cached && cached.expiresAt - now() > 60_000
        ? cached.token
        : refresh(scope);
    },
    async refreshAccessToken(scope) {
      cached = null;
      return refresh(scope);
    },
  });
}
