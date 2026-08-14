import { parseAuthConfig } from "@/server/auth/config";
import { isLocalOrPrivateHostname } from "@/server/network/private-hostname";

type MutationErrorCode = "FORBIDDEN" | "UNSUPPORTED_MEDIA_TYPE" | "PAYLOAD_TOO_LARGE";

export class MutationRequestError extends Error {
  constructor(
    message: string,
    public readonly status: 403 | 413 | 415,
    public readonly code: MutationErrorCode,
  ) {
    super(message);
    this.name = "MutationRequestError";
  }
}

export function isTrustedMutationOrigin(
  request: Request,
  trustedOrigin: string,
) {
  const origin = request.headers.get("Origin");
  if (origin === trustedOrigin) return true;
  if (!origin) return false;

  try {
    const configured = new URL(trustedOrigin);
    const current = new URL(origin);
    const host = request.headers.get("Host")?.trim();
    const requestTarget = host
      ? new URL(`${current.protocol}//${host}`)
      : new URL(request.url);
    return (
      configured.origin === trustedOrigin &&
      current.origin === origin &&
      !requestTarget.username &&
      !requestTarget.password &&
      requestTarget.pathname === "/" &&
      !requestTarget.search &&
      !requestTarget.hash &&
      configured.protocol === "http:" &&
      current.protocol === "http:" &&
      isLocalOrPrivateHostname(configured.hostname) &&
      isLocalOrPrivateHostname(current.hostname) &&
      current.origin === requestTarget.origin
    );
  } catch {
    return false;
  }
}

export function assertTrustedMutationRequest(
  request: Request,
  trustedOrigin = parseAuthConfig().origin,
) {
  const fetchSite = request.headers.get("Sec-Fetch-Site");

  if (
    !isTrustedMutationOrigin(request, trustedOrigin) ||
    (fetchSite !== null && fetchSite !== "same-origin")
  ) {
    throw new MutationRequestError(
      "The request origin is not allowed",
      403,
      "FORBIDDEN",
    );
  }

  if (request.body !== null) {
    const mediaType = request.headers
      .get("Content-Type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase();

    if (mediaType !== "application/json") {
      throw new MutationRequestError(
        "Request bodies must use application/json",
        415,
        "UNSUPPORTED_MEDIA_TYPE",
      );
    }
  }
}

export async function parseBoundedJson(
  request: Request,
  maximumBytes = 256 * 1024,
): Promise<unknown> {
  if (!request.body) return JSON.parse("");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new MutationRequestError(
        "Request body is too large",
        413,
        "PAYLOAD_TOO_LARGE",
      );
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
}
