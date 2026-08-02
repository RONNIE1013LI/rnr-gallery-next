import { describe, expect, it } from "vitest";
import { MutationRequestError } from "./mutation-request";
import { assertTrustedMultipartMutationRequest } from "./multipart-mutation-request";

const trustedOrigin = "https://shop.example.test";

function uploadRequest({
  contentType = "multipart/form-data; boundary=upload-boundary",
  fetchSite = "same-origin",
  origin = trustedOrigin,
}: {
  contentType?: string | null;
  fetchSite?: string | null;
  origin?: string | null;
} = {}) {
  const headers = new Headers();
  if (contentType) headers.set("Content-Type", contentType);
  if (fetchSite) headers.set("Sec-Fetch-Site", fetchSite);
  if (origin) headers.set("Origin", origin);
  return new Request(`${trustedOrigin}/api/uploads`, {
    method: "POST",
    headers,
    body: "body",
  });
}

describe("assertTrustedMultipartMutationRequest", () => {
  it("accepts a same-origin multipart form with a boundary", () => {
    expect(() =>
      assertTrustedMultipartMutationRequest(uploadRequest(), trustedOrigin),
    ).not.toThrow();
  });

  it.each([
    ["missing origin", { origin: null }, 403, "FORBIDDEN"],
    ["foreign origin", { origin: "https://attacker.example" }, 403, "FORBIDDEN"],
    ["cross-site metadata", { fetchSite: "cross-site" }, 403, "FORBIDDEN"],
    ["JSON", { contentType: "application/json" }, 415, "UNSUPPORTED_MEDIA_TYPE"],
    ["a missing boundary", { contentType: "multipart/form-data" }, 415, "UNSUPPORTED_MEDIA_TYPE"],
  ] as const)("rejects %s", (_name, options, status, code) => {
    try {
      assertTrustedMultipartMutationRequest(uploadRequest(options), trustedOrigin);
      throw new Error("Expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(MutationRequestError);
      expect(error).toMatchObject({ status, code });
    }
  });
});
