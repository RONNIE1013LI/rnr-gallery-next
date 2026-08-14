import { describe, expect, it } from "vitest";
import { MutationRequestError } from "./mutation-request";
import {
  assertTrustedMultipartMutationRequest,
  parseBoundedMultipartFormData,
} from "./multipart-mutation-request";

const trustedOrigin = "https://shop.example.test";

function uploadRequest({
  contentType = "multipart/form-data; boundary=upload-boundary",
  fetchSite = "same-origin",
  host,
  origin = trustedOrigin,
  requestOrigin = trustedOrigin,
}: {
  contentType?: string | null;
  fetchSite?: string | null;
  host?: string;
  origin?: string | null;
  requestOrigin?: string;
} = {}) {
  const headers = new Headers();
  if (contentType) headers.set("Content-Type", contentType);
  if (fetchSite) headers.set("Sec-Fetch-Site", fetchSite);
  if (host) headers.set("Host", host);
  if (origin) headers.set("Origin", origin);
  return new Request(`${requestOrigin}/api/uploads`, {
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

  it("accepts localhost uploads when the configured local origin uses the LAN IP", () => {
    const localhost = "http://localhost:3000";

    expect(() =>
      assertTrustedMultipartMutationRequest(
        uploadRequest({
          host: "localhost:3000",
          origin: localhost,
          requestOrigin: "http://0.0.0.0:3000",
        }),
        "http://192.168.4.199:3000",
      ),
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

  it("stops reading a chunked multipart body once the byte limit is exceeded", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("1234"));
        controller.enqueue(new TextEncoder().encode("5678"));
        controller.close();
      },
    });
    const request = new Request(`${trustedOrigin}/api/uploads`, {
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data; boundary=upload-boundary",
        Origin: trustedOrigin,
        "Sec-Fetch-Site": "same-origin",
      },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(parseBoundedMultipartFormData(request, 6)).rejects.toMatchObject({
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
    });
  });
});
