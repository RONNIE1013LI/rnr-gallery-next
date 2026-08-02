import { describe, expect, it } from "vitest";

import {
  assertTrustedMutationRequest,
  MutationRequestError,
} from "./mutation-request";

const trustedOrigin = "https://shop.example.test";

function mutationRequest({
  body = "{}",
  contentType = "application/json",
  fetchSite = "same-origin",
  method = "POST",
  origin = trustedOrigin,
}: {
  body?: string | null;
  contentType?: string | null;
  fetchSite?: string | null;
  method?: "POST" | "PUT" | "DELETE";
  origin?: string | null;
} = {}) {
  const headers = new Headers();
  if (contentType) headers.set("Content-Type", contentType);
  if (fetchSite) headers.set("Sec-Fetch-Site", fetchSite);
  if (origin) headers.set("Origin", origin);

  return new Request(`${trustedOrigin}/api/account/addresses`, {
    body: body ?? undefined,
    headers,
    method,
  });
}

describe("assertTrustedMutationRequest", () => {
  it("accepts same-origin JSON and a bodyless same-origin delete", () => {
    expect(() =>
      assertTrustedMutationRequest(mutationRequest(), trustedOrigin),
    ).not.toThrow();
    expect(() =>
      assertTrustedMutationRequest(
        mutationRequest({ body: null, contentType: null, method: "DELETE" }),
        trustedOrigin,
      ),
    ).not.toThrow();
  });

  it.each([
    ["a missing Origin", { origin: null }, 403, "FORBIDDEN"],
    [
      "a foreign Origin",
      { origin: "https://attacker.example" },
      403,
      "FORBIDDEN",
    ],
    [
      "cross-site Fetch Metadata",
      { fetchSite: "cross-site" },
      403,
      "FORBIDDEN",
    ],
    [
      "a text/plain body",
      { contentType: "text/plain" },
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    ],
  ] as const)("rejects %s", (_name, requestOptions, status, code) => {
    try {
      assertTrustedMutationRequest(
        mutationRequest(requestOptions),
        trustedOrigin,
      );
      throw new Error("Expected the mutation boundary to reject the request");
    } catch (error) {
      expect(error).toBeInstanceOf(MutationRequestError);
      expect(error).toMatchObject({ status, code });
    }
  });
});
