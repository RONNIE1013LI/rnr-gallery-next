import { describe, expect, it, vi } from "vitest";
import { GOOGLE_DATA_MANAGER_OAUTH_SCOPE } from "./google-data-manager-client";
import {
  createGoogleDataManagerOAuthTokenProvider,
  parseGoogleDataManagerOAuthCredentials,
} from "./google-data-manager-oauth";

describe("Google Data Manager OAuth token provider", () => {
  it("fails closed when any server-side credential is absent", () => {
    expect(parseGoogleDataManagerOAuthCredentials({})).toBeNull();
    expect(parseGoogleDataManagerOAuthCredentials({
      GOOGLE_DATA_MANAGER_OAUTH_CLIENT_ID: "client",
      GOOGLE_DATA_MANAGER_OAUTH_CLIENT_SECRET: "secret",
    })).toBeNull();
  });

  it("exchanges the refresh credential server-side and caches only a live access token", async () => {
    let now = 1_000_000;
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: "short-lived-access",
      expires_in: 3_600,
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const credentials = parseGoogleDataManagerOAuthCredentials({
      GOOGLE_DATA_MANAGER_OAUTH_CLIENT_ID: "client",
      GOOGLE_DATA_MANAGER_OAUTH_CLIENT_SECRET: "secret",
      GOOGLE_DATA_MANAGER_OAUTH_REFRESH_TOKEN: "refresh",
    });
    expect(credentials).not.toBeNull();
    const provider = createGoogleDataManagerOAuthTokenProvider({
      credentials: credentials!,
      fetchImpl,
      now: () => now,
    });

    await expect(provider.getAccessToken(GOOGLE_DATA_MANAGER_OAUTH_SCOPE))
      .resolves.toBe("short-lived-access");
    await expect(provider.getAccessToken(GOOGLE_DATA_MANAGER_OAUTH_SCOPE))
      .resolves.toBe("short-lived-access");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const request = fetchImpl.mock.calls[0][1];
    expect(String(request.body)).toContain("grant_type=refresh_token");
    expect(JSON.stringify(request)).not.toContain("short-lived-access");

    now += 3_600_000;
    await provider.getAccessToken(GOOGLE_DATA_MANAGER_OAUTH_SCOPE);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
