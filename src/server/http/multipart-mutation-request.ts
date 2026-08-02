import { parseAuthConfig } from "@/server/auth/config";
import { MutationRequestError } from "./mutation-request";

export function assertTrustedMultipartMutationRequest(
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
}
