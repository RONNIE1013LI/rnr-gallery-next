const GRAPH_PROFILE_BASE = "https://graph.facebook.com/v23.0";
const MAX_NAME_PART_LENGTH = 80;
const MAX_DISPLAY_NAME_LENGTH = 160;

export type FacebookProfileResolution =
  | Readonly<{ status: "resolved"; customerDisplayName: string }>
  | Readonly<{ status: "temporary_failure" }>
  | Readonly<{ status: "unavailable" }>;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function sanitizeNamePart(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]+/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_PART_LENGTH)
    .trim();
}

export function createFacebookProfileResolver(input: Readonly<{
  token: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}>) {
  if (!input.token.trim()) throw new Error("facebook_profile_lookup_token_missing");
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? 1_500;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5_000) {
    throw new Error("facebook_profile_lookup_timeout_invalid");
  }

  return {
    async resolve(rawPsid: string): Promise<FacebookProfileResolution> {
      if (!rawPsid || rawPsid.length > 256) return { status: "unavailable" };
      const url = new URL(`${GRAPH_PROFILE_BASE}/${encodeURIComponent(rawPsid)}`);
      url.searchParams.set("fields", "first_name,last_name");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${input.token}` },
          signal: controller.signal,
          cache: "no-store",
        });
        if (response.status === 429 || response.status >= 500) {
          return { status: "temporary_failure" };
        }
        if (!response.ok) return { status: "unavailable" };

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          return { status: "unavailable" };
        }
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          return { status: "unavailable" };
        }
        const profile = payload as { first_name?: unknown; last_name?: unknown };
        const displayName = [
          sanitizeNamePart(profile.first_name),
          sanitizeNamePart(profile.last_name),
        ].filter(Boolean).join(" ").slice(0, MAX_DISPLAY_NAME_LENGTH).trim();
        return displayName
          ? { status: "resolved", customerDisplayName: displayName }
          : { status: "unavailable" };
      } catch {
        return { status: "temporary_failure" };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
