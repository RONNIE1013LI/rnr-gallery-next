import { describe, expect, it } from "vitest";

import {
  assertTrustedMutationRequest,
  MutationRequestError,
  parseBoundedJson,
} from "./mutation-request";

const trustedOrigin = "https://shop.example.test";

function mutationRequest({
  body = "{}",
  contentType = "application/json",
  fetchSite = "same-origin",
  host,
  method = "POST",
  origin = trustedOrigin,
  requestOrigin = trustedOrigin,
}: {
  body?: string | null;
  contentType?: string | null;
  fetchSite?: string | null;
  host?: string;
  method?: "POST" | "PUT" | "DELETE";
  origin?: string | null;
  requestOrigin?: string;
} = {}) {
  const headers = new Headers();
  if (contentType) headers.set("Content-Type", contentType);
  if (fetchSite) headers.set("Sec-Fetch-Site", fetchSite);
  if (host) headers.set("Host", host);
  if (origin) headers.set("Origin", origin);

  return new Request(`${requestOrigin}/api/account/addresses`, {
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

  it("accepts localhost as a same-origin alternative to a configured LAN origin", () => {
    const localhost = "http://localhost:3000";

    expect(() =>
      assertTrustedMutationRequest(
        mutationRequest({
          host: "localhost:3000",
          origin: localhost,
          requestOrigin: "http://0.0.0.0:3000",
        }),
        "http://192.168.4.199:3000",
      ),
    ).not.toThrow();
  });

  it("rejects a local alternative when Origin and Host do not match", () => {
    expect(() =>
      assertTrustedMutationRequest(
        mutationRequest({
          host: "192.168.4.199:3000",
          origin: "http://localhost:3000",
          requestOrigin: "http://0.0.0.0:3000",
        }),
        "http://192.168.4.199:3000",
      ),
    ).toThrowError(MutationRequestError);
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

  it("stops reading a chunked JSON body after the configured limit", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":"'));
        controller.enqueue(new TextEncoder().encode('too large"}'));
        controller.close();
      },
    });
    const request = new Request(`${trustedOrigin}/api/checkout/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: trustedOrigin,
        "Sec-Fetch-Site": "same-origin",
      },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(parseBoundedJson(request, 12)).rejects.toMatchObject({
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
    });
  });
});
