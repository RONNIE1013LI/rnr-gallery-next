import { parseAuthConfig } from "@/server/auth/config";
import {
  isTrustedMutationOrigin,
  MutationRequestError,
} from "./mutation-request";

export function assertTrustedMultipartMutationRequest(
  request: Request,
  trustedOrigin = parseAuthConfig().origin,
  maximumBytes = 16 * 1024 * 1024,
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

  const contentType = request.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (
    !contentType.startsWith("multipart/form-data;") ||
    !/(?:^|;)\s*boundary\s*=\s*(?:"[^"]+"|[^;\s]+)/i.test(contentType)
  ) {
    throw new MutationRequestError(
      "Request bodies must use multipart/form-data with a boundary",
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    );
  }

  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null) {
    const length = Number(contentLength);
    if (!Number.isFinite(length) || length < 0 || length > maximumBytes) {
      throw new MutationRequestError(
        "Request body is too large",
        413,
        "PAYLOAD_TOO_LARGE",
      );
    }
  }
}

export async function parseBoundedMultipartFormData(
  request: Request,
  maximumBytes = 16 * 1024 * 1024,
) {
  if (!request.body) return new FormData();

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
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
  }).formData();
}
