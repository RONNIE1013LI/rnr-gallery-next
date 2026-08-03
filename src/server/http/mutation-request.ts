import { parseAuthConfig } from "@/server/auth/config";

type MutationErrorCode = "FORBIDDEN" | "UNSUPPORTED_MEDIA_TYPE";

export class MutationRequestError extends Error {
  constructor(
    message: string,
    public readonly status: 403 | 415,
    public readonly code: MutationErrorCode,
  ) {
    super(message);
    this.name = "MutationRequestError";
  }
}

export function assertTrustedMutationRequest(
  request: Request,
  trustedOrigin = parseAuthConfig().origin,
) {
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");

  if (
    origin !== trustedOrigin ||
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

export function assertTrustedMultipartMutationRequest(
  request: Request,
  trustedOrigin = parseAuthConfig().origin,
  maximumBytes = 16 * 1024 * 1024,
) {
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (origin !== trustedOrigin || (fetchSite !== null && fetchSite !== "same-origin")) {
    throw new MutationRequestError("The request origin is not allowed", 403, "FORBIDDEN");
  }
  const mediaType = request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "multipart/form-data") {
    throw new MutationRequestError("Request bodies must use multipart/form-data", 415, "UNSUPPORTED_MEDIA_TYPE");
  }
  const length = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(length) && length > maximumBytes) {
    throw new MutationRequestError("Request body is too large", 415, "UNSUPPORTED_MEDIA_TYPE");
  }
}
