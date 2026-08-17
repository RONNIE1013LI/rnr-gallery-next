import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { IMAGE_LIMITS } from "./limits";
import type { AttachmentSourceRef } from "./types";
import {
  validateImageAttachment,
  type AttachmentSourceReader,
  type ResolvedAttachment,
} from "./image-validation";

type DnsAddress = Readonly<{ address: string; family: 4 | 6 }>;
type Lookup = (hostname: string) => Promise<readonly DnsAddress[]>;
type FetchResult = Readonly<{
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
}>;
type AttachmentFetch = (
  url: string,
  init: RequestInit & Readonly<{ addresses: readonly DnsAddress[] }>,
) => Promise<FetchResult>;

type FacebookSourceReaderOptions = Readonly<{
  allowedHosts: readonly string[];
  lookup?: Lookup;
  fetch?: AttachmentFetch;
}>;

const nonPublicAddresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
] as const) {
  nonPublicAddresses.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
] as const) {
  nonPublicAddresses.addSubnet(network, prefix, "ipv6");
}

async function defaultLookup(hostname: string): Promise<readonly DnsAddress[]> {
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  return addresses.map(({ address, family }) => ({
    address,
    family: family === 6 ? 6 as const : 4 as const,
  }));
}

function pinnedLookup(addresses: readonly DnsAddress[]): LookupFunction {
  return ((_hostname, options, callback) => {
    if (typeof options === "object" && options.all) {
      callback(null, addresses.map(({ address, family }) => ({ address, family })));
      return;
    }
    const first = addresses[0];
    callback(null, first.address, first.family);
  }) as LookupFunction;
}

function defaultFetch(
  url: string,
  init: RequestInit & Readonly<{ addresses: readonly DnsAddress[] }>,
): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, {
      method: "GET",
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      lookup: pinnedLookup(init.addresses),
      signal: init.signal ?? undefined,
    }, (response) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) {
          for (const item of value) headers.append(name, item);
        } else if (value !== undefined) {
          headers.set(name, String(value));
        }
      }
      resolve({
        status: response.statusCode ?? 0,
        headers,
        body: Readable.toWeb(response) as unknown as ReadableStream<Uint8Array>,
      });
    });
    request.on("error", reject);
    request.end();
  });
}

function normalizedHostname(url: URL) {
  return url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;
}

function pathMimeType(url: URL): ResolvedAttachment["mimeType"] {
  const pathname = url.pathname.toLowerCase();
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".webp")) return "image/webp";
  throw new Error("Unsupported Facebook attachment path");
}

function hasExplicitPort(value: string) {
  const authority = /^(?:[a-z][a-z\d+.-]*:)?\/\/([^/?#]*)/i.exec(value)?.[1];
  if (authority === undefined) return false;
  const hostAndPort = authority.slice(authority.lastIndexOf("@") + 1);
  if (hostAndPort.startsWith("[")) {
    const closingBracket = hostAndPort.indexOf("]");
    return closingBracket >= 0 && hostAndPort.slice(closingBracket + 1).startsWith(":");
  }
  return hostAndPort.includes(":");
}

function safeUrl(value: string, allowedHosts: ReadonlySet<string>, base?: URL) {
  let url: URL;
  try {
    if (value.includes("\\") || hasExplicitPort(value)) {
      throw new Error("Unsafe Facebook attachment URL");
    }
    url = new URL(value, base);
  } catch {
    throw new Error("Unsafe Facebook attachment URL");
  }
  const hostname = normalizedHostname(url);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    isIP(hostname) !== 0 ||
    !allowedHosts.has(hostname.toLowerCase())
  ) {
    throw new Error("Unsafe Facebook attachment URL");
  }
  return Object.freeze({ url, mimeType: pathMimeType(url) });
}

function isNonPublicAddress({ address, family }: DnsAddress) {
  const expectedFamily = family === 4 ? "ipv4" : "ipv6";
  return isIP(address) !== family || nonPublicAddresses.check(address, expectedFamily);
}

async function cancelResponseBody(response: FetchResult) {
  await response.body?.cancel().catch(() => undefined);
}

async function readBoundedBody(response: FetchResult, signal: AbortSignal) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      await cancelResponseBody(response);
      throw new Error("Invalid Facebook attachment response");
    }
    if (parsedLength > IMAGE_LIMITS.maxBytesPerImage) {
      await cancelResponseBody(response);
      throw new Error("Facebook attachment exceeds byte limit");
    }
  }
  if (!response.body) throw new Error("Invalid Facebook attachment response");

  const chunks: Buffer[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > IMAGE_LIMITS.maxBytesPerImage) {
        throw new Error("Facebook attachment exceeds byte limit");
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export function createFacebookSourceReader({
  allowedHosts,
  lookup = defaultLookup,
  fetch = defaultFetch,
}: FacebookSourceReaderOptions): AttachmentSourceReader {
  const allowedHostSet = new Set(allowedHosts.map((host) => host.toLowerCase()));
  return Object.freeze({
    channel: "facebook" as const,
    async read(source: AttachmentSourceRef, signal: AbortSignal) {
      if (source.kind !== "facebook_remote") {
        throw new Error("Unsupported Facebook attachment source");
      }

      let current = safeUrl(source.url, allowedHostSet);
      for (let redirects = 0; ; redirects += 1) {
        const hostname = normalizedHostname(current.url);
        const addresses = await lookup(hostname);
        if (addresses.length === 0 || addresses.some(isNonPublicAddress)) {
          throw new Error("Facebook attachment host resolved to a non-public address");
        }
        const response = await fetch(current.url.toString(), {
          addresses,
          headers: { accept: "image/jpeg, image/png, image/webp" },
          redirect: "manual",
          signal,
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await cancelResponseBody(response);
          if (redirects >= IMAGE_LIMITS.maxRedirects) {
            throw new Error("Too many Facebook attachment redirects");
          }
          const location = response.headers.get("location");
          if (!location) throw new Error("Invalid Facebook attachment redirect");
          current = safeUrl(location, allowedHostSet, current.url);
          continue;
        }
        if (response.status < 200 || response.status >= 300) {
          await cancelResponseBody(response);
          throw new Error("Facebook attachment download failed");
        }
        const bytes = await readBoundedBody(response, signal);
        const attachment = await validateImageAttachment(
          bytes,
          response.headers.get("content-type") ?? "",
        );
        if (attachment.mimeType !== current.mimeType) {
          throw new Error("Image path extension does not match image type");
        }
        return attachment;
      }
    },
  });
}
