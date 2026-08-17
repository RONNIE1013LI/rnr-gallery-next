import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { IMAGE_LIMITS } from "./limits";
import { createFacebookSourceReader } from "./facebook-source-reader";

const allowedHosts = ["cdn.facebook.test", "redirect.facebook.test"];
let validPng: Buffer;

beforeAll(async () => {
  validPng = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: { r: 24, g: 48, b: 72 },
    },
  }).png().toBuffer();
});

function publicLookup() {
  return vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 as const }]);
}

function imageResponse(bytes: Buffer | string = validPng, headers: HeadersInit = {}) {
  const body = typeof bytes === "string" ? bytes : Uint8Array.from(bytes).buffer;
  return new Response(body, {
    status: 200,
    headers: { "content-type": "image/png", ...headers },
  });
}

function cancellableResponse(status: number, headers: HeadersInit = {}) {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
    },
    cancel,
  });
  return {
    cancel,
    response: new Response(body, { status, headers }),
  };
}

function rawRedirectResponse(location: string) {
  const response = new Response(null, { status: 302 });
  Object.defineProperty(response, "headers", {
    value: {
      get(name: string) {
        return name.toLowerCase() === "location" ? location : null;
      },
    },
  });
  return response;
}

function reader(options: {
  lookup?: ReturnType<typeof publicLookup>;
  fetch?: typeof fetch;
} = {}) {
  return createFacebookSourceReader({
    allowedHosts,
    lookup: options.lookup ?? publicLookup(),
    fetch: options.fetch ?? vi.fn().mockResolvedValue(imageResponse()),
  });
}

describe("Facebook attachment URL validation", () => {
  it.each([
    "http://cdn.facebook.test/image.png",
    "https://user:password@cdn.facebook.test/image.png",
    "https://127.0.0.1/image.png",
    "https://[::1]/image.png",
    "https://2130706433/image.png",
    "https://0x7f000001/image.png",
    "https://evil.test/image.png",
    "https://cdn.facebook.test.evil.test/image.png",
    "https://cdn.facebook.test:443/image.png",
    "https://cdn.facebook.test:444/image.png",
    " https://cdn.facebook.test/image.png",
    "https://cdn.facebook.test/image.png ",
    "https:////cdn.facebook.test:443/image.png",
  ])("rejects unsafe source URL %s", async (url) => {
    await expect(reader().read(
      { kind: "facebook_remote", url },
      new AbortController().signal,
    )).rejects.toThrow("Unsafe Facebook attachment URL");
  });

  it.each([
    "https://cdn.facebook.test/image",
    "https://cdn.facebook.test/image.gif",
  ])("rejects a source URL without a supported image extension: %s", async (url) => {
    await expect(reader().read(
      { kind: "facebook_remote", url },
      new AbortController().signal,
    )).rejects.toThrow("Unsupported Facebook attachment path");
  });

  it("rejects an image whose MIME type disagrees with the path extension", async () => {
    await expect(reader().read(
      { kind: "facebook_remote", url: "https://cdn.facebook.test/image.jpg" },
      new AbortController().signal,
    )).rejects.toThrow("Image path extension does not match");
  });

  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "::",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])("rejects a non-public DNS address %s", async (address) => {
    const lookup = vi.fn().mockResolvedValue([{
      address,
      family: address.includes(":") ? 6 as const : 4 as const,
    }]);

    await expect(reader({ lookup }).read(
      { kind: "facebook_remote", url: "https://cdn.facebook.test/image.png" },
      new AbortController().signal,
    )).rejects.toThrow("Facebook attachment host resolved to a non-public address");
  });

  it.each([
    "0.0.0.0",
    "10.255.255.255",
    "100.64.0.0",
    "100.127.255.255",
    "127.255.255.255",
    "169.254.255.255",
    "172.16.0.0",
    "172.31.255.255",
    "192.0.0.255",
    "192.0.2.255",
    "192.88.99.1",
    "192.168.255.255",
    "198.18.0.0",
    "198.19.255.255",
    "198.51.100.255",
    "203.0.113.255",
    "224.0.0.0",
    "239.255.255.255",
    "240.0.0.0",
    "255.255.255.255",
  ])("fails closed for IANA non-public/special-use IPv4 address %s", async (address) => {
    const lookup = vi.fn().mockResolvedValue([{ address, family: 4 as const }]);
    const fetchMock = vi.fn().mockResolvedValue(imageResponse());

    await expect(reader({ lookup, fetch: fetchMock }).read(
      { kind: "facebook_remote", url: "https://cdn.facebook.test/image.png" },
      new AbortController().signal,
    )).rejects.toThrow("Facebook attachment host resolved to a non-public address");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    "8.8.8.8",
    "93.184.216.34",
    "100.63.255.255",
    "100.128.0.0",
    "172.15.255.255",
    "172.32.0.0",
    "192.31.196.1",
    "192.52.193.1",
    "192.175.48.1",
    "223.255.255.254",
  ])("allows a public IPv4 DNS address %s", async (address) => {
    const lookup = vi.fn().mockResolvedValue([{ address, family: 4 as const }]);
    const fetchMock = vi.fn().mockResolvedValue(imageResponse());

    await expect(reader({ lookup, fetch: fetchMock }).read(
      { kind: "facebook_remote", url: "https://cdn.facebook.test/image.png" },
      new AbortController().signal,
    )).resolves.toMatchObject({ mimeType: "image/png" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("revalidates redirects and rejects an allowlist escape", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, {
      status: 302,
      headers: { location: "https://evil.test/private.png" },
    }));

    await expect(reader({ fetch: fetchMock }).read(
      { kind: "facebook_remote", url: "https://cdn.facebook.test/image.png" },
      new AbortController().signal,
    )).rejects.toThrow("Unsafe Facebook attachment URL");
  });

  it("rejects a redirect whose approved hostname resolves privately", async () => {
    const lookup = vi.fn()
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 as const }])
      .mockResolvedValueOnce([{ address: "10.0.0.1", family: 4 as const }]);
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, {
      status: 302,
      headers: { location: "https://redirect.facebook.test/image.png" },
    }));

    await expect(reader({ lookup, fetch: fetchMock }).read(
      { kind: "facebook_remote", url: "https://cdn.facebook.test/image.png" },
      new AbortController().signal,
    )).rejects.toThrow("Facebook attachment host resolved to a non-public address");
  });

  it("revalidates the path extension after a redirect", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: "/image" },
      }))
      .mockResolvedValueOnce(imageResponse());

    await expect(reader({ fetch: fetchMock }).read(
      { kind: "facebook_remote", url: "https://cdn.facebook.test/start.png" },
      new AbortController().signal,
    )).rejects.toThrow("Unsupported Facebook attachment path");
  });

  it("rejects an explicit default port after a redirect", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: "https://redirect.facebook.test:443/image.png" },
      }))
      .mockResolvedValueOnce(imageResponse());

    await expect(reader({ fetch: fetchMock }).read(
      { kind: "facebook_remote", url: "https://cdn.facebook.test/start.png" },
      new AbortController().signal,
    )).rejects.toThrow("Unsafe Facebook attachment URL");
  });

  it.each([
    " https://redirect.facebook.test/image.png",
    "https:////redirect.facebook.test:443/image.png",
    "//redirect.facebook.test/image.png",
  ])("rejects a non-canonical redirect Location: %s", async (location) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(rawRedirectResponse(location))
      .mockResolvedValueOnce(imageResponse());

    await expect(reader({ fetch: fetchMock }).read(
      { kind: "facebook_remote", url: "https://cdn.facebook.test/start.png" },
      new AbortController().signal,
    )).rejects.toThrow("Unsafe Facebook attachment URL");
  });

  it("permits at most two redirects", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/one.png" } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/two.png" } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/three.png" } }));

    await expect(reader({ fetch: fetchMock }).read(
      { kind: "facebook_remote", url: "https://cdn.facebook.test/start.png" },
      new AbortController().signal,
    )).rejects.toThrow("Too many Facebook attachment redirects");
  });

  it("resolves each redirect host and sends no authorization or cookie headers", async () => {
    const lookup = publicLookup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: "https://redirect.facebook.test/image.png" },
      }))
      .mockResolvedValueOnce(imageResponse());

    await reader({ lookup, fetch: fetchMock }).read(
      { kind: "facebook_remote", url: "https://cdn.facebook.test/start.png" },
      new AbortController().signal,
    );

    expect(lookup).toHaveBeenNthCalledWith(1, "cdn.facebook.test");
    expect(lookup).toHaveBeenNthCalledWith(2, "redirect.facebook.test");
    for (const [, init] of fetchMock.mock.calls) {
      const headers = new Headers(init?.headers);
      expect(headers.has("authorization")).toBe(false);
      expect(headers.has("cookie")).toBe(false);
      expect(init).toMatchObject({
        addresses: [{ address: "93.184.216.34", family: 4 }],
        redirect: "manual",
      });
    }
  });
});

describe("Facebook attachment response bounds", () => {
  it("rejects a declared image above the byte limit before reading", async () => {
    const fetchMock = vi.fn().mockResolvedValue(imageResponse(validPng, {
      "content-length": String(IMAGE_LIMITS.maxBytesPerImage + 1),
    }));

    await expect(reader({ fetch: fetchMock }).read(
      { kind: "facebook_remote", url: "https://cdn.facebook.test/image.png" },
      new AbortController().signal,
    )).rejects.toThrow("Facebook attachment exceeds byte limit");
  });

  it.each([true, false])(
    "rejects a streaming image above the byte limit when Content-Length is present: %s",
    async (withContentLength) => {
      const chunk = new Uint8Array(1024 * 1024);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let index = 0; index < 5; index += 1) controller.enqueue(chunk);
          controller.close();
        },
      });
      const headers = new Headers({ "content-type": "image/png" });
      if (withContentLength) headers.set("content-length", String(IMAGE_LIMITS.maxBytesPerImage));
      const fetchMock = vi.fn().mockResolvedValue(new Response(stream, { status: 200, headers }));

      await expect(reader({ fetch: fetchMock }).read(
        { kind: "facebook_remote", url: "https://cdn.facebook.test/image.png" },
        new AbortController().signal,
      )).rejects.toThrow("Facebook attachment exceeds byte limit");
    },
  );

  it("rejects an unsupported response MIME type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(Uint8Array.from(validPng).buffer, {
      status: 200,
      headers: { "content-type": "image/gif" },
    }));

    await expect(reader({ fetch: fetchMock }).read(
      { kind: "facebook_remote", url: "https://cdn.facebook.test/image.png" },
      new AbortController().signal,
    )).rejects.toThrow("Unsupported image type");
  });

  it("rejects a supported MIME type with wrong magic bytes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(imageResponse("not an image"));

    await expect(reader({ fetch: fetchMock }).read(
      { kind: "facebook_remote", url: "https://cdn.facebook.test/image.png" },
      new AbortController().signal,
    )).rejects.toThrow("Image signature does not match");
  });
});

describe("Facebook attachment response cleanup", () => {
  it("cancels the body when Content-Length declares an oversized response", async () => {
    const { cancel, response } = cancellableResponse(200, {
      "content-length": String(IMAGE_LIMITS.maxBytesPerImage + 1),
      "content-type": "image/png",
    });
    const fetchMock = vi.fn().mockResolvedValue(response);

    await expect(reader({ fetch: fetchMock }).read(
      { kind: "facebook_remote", url: "https://cdn.facebook.test/image.png" },
      new AbortController().signal,
    )).rejects.toThrow("Facebook attachment exceeds byte limit");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("cancels the redirect response body before following Location", async () => {
    const { cancel, response } = cancellableResponse(302, {
      location: "/redirected.png",
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(imageResponse());

    await reader({ fetch: fetchMock }).read(
      { kind: "facebook_remote", url: "https://cdn.facebook.test/image.png" },
      new AbortController().signal,
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("cancels a non-2xx terminal response body", async () => {
    const { cancel, response } = cancellableResponse(404);
    const fetchMock = vi.fn().mockResolvedValue(response);

    await expect(reader({ fetch: fetchMock }).read(
      { kind: "facebook_remote", url: "https://cdn.facebook.test/image.png" },
      new AbortController().signal,
    )).rejects.toThrow("Facebook attachment download failed");
    expect(cancel).toHaveBeenCalledOnce();
  });
});
