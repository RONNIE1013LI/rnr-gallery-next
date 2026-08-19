import { describe, expect, it } from "vitest";
import { google as createGoogleProvider } from "@better-auth/core/social-providers";

import {
  getConfiguredSocialProviderIds,
  getSocialProviderOptions,
} from "./social-provider-config";

describe("social provider configuration", () => {
  it("enables only providers with both a client ID and secret", () => {
    const env = {
      GOOGLE_CLIENT_ID: "google-client",
      GOOGLE_CLIENT_SECRET: "google-secret",
      GITHUB_CLIENT_ID: "github-client-without-secret",
      APPLE_CLIENT_ID: "apple-client",
      APPLE_CLIENT_SECRET: "apple-secret",
    };

    expect(getConfiguredSocialProviderIds(env)).toEqual(["google", "apple"]);
    expect(getSocialProviderOptions(env)).toEqual({
      google: {
        clientId: "google-client",
        clientSecret: "google-secret",
        prompt: "select_account",
      },
      apple: {
        clientId: "apple-client",
        clientSecret: "apple-secret",
      },
    });
  });

  it("returns no providers when credentials are absent", () => {
    expect(getConfiguredSocialProviderIds({})).toEqual([]);
    expect(getSocialProviderOptions({})).toEqual({});
  });

  it("makes Better Auth request Google's account chooser", async () => {
    const options = getSocialProviderOptions({
      GOOGLE_CLIENT_ID: "google-client",
      GOOGLE_CLIENT_SECRET: "google-secret",
    });
    const provider = createGoogleProvider(options.google!);

    const authorizationURL = await provider.createAuthorizationURL({
      state: "test-state",
      codeVerifier: "test-code-verifier",
      redirectURI: "https://shop.example.test/api/auth/callback/google",
    });

    expect(authorizationURL.searchParams.get("prompt")).toBe("select_account");
    expect(options.apple).toBeUndefined();
  });
});
