import {
  hashCheckoutSessionToken,
  isCheckoutSessionToken,
} from "@/server/checkout/session-cookie";
import type { CustomerProofAccess } from "./production-proof-service";
import { verifyProofAccess } from "./proof-access-link";

export function resolveCustomerProofAccess(
  input: Readonly<{
    orderNumber: string;
    fileId?: string | null;
    expires?: number | null;
    signature?: string | null;
    userId?: string | null;
    checkoutToken?: string | null;
  }>,
  proofSecret: string,
  now = new Date(),
): CustomerProofAccess | null {
  if (
    input.fileId &&
    input.expires &&
    input.signature &&
    verifyProofAccess({
      orderNumber: input.orderNumber,
      fileId: input.fileId,
      expires: input.expires,
    }, input.signature, proofSecret, now)
  ) {
    return Object.freeze({ kind: "signed", fileId: input.fileId });
  }
  if (input.userId?.trim()) {
    return Object.freeze({ kind: "customer", userId: input.userId.trim() });
  }
  if (input.checkoutToken && isCheckoutSessionToken(input.checkoutToken)) {
    return Object.freeze({
      kind: "checkout",
      tokenDigest: hashCheckoutSessionToken(input.checkoutToken),
    });
  }
  return null;
}
