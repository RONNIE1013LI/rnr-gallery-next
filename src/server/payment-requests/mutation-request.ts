import { assertTrustedMutationRequest } from "@/server/http/mutation-request";

const productionOrigins = new Set([
  "https://rnrgallery.com", "https://www.rnrgallery.com",
  "https://rrgallery.co.nz", "https://www.rrgallery.co.nz",
]);

export function assertPaymentRequestMutation(request: Request, configuredOrigin: string) {
  const targetOrigin = new URL(request.url).origin;
  // Public payment links use all Production aliases, but still require a same-origin request.
  const trustedOrigin = configuredOrigin === "https://rnrgallery.com" && productionOrigins.has(targetOrigin)
    ? targetOrigin : configuredOrigin;
  assertTrustedMutationRequest(request, trustedOrigin);
}
