import { describe, expect, it } from "vitest";
import { createCheckoutSessionToken, hashCheckoutSessionToken } from "@/server/checkout/session-cookie";
import { signProofAccess } from "./proof-access-link";
import { resolveCustomerProofAccess } from "./customer-proof-access";

const secret = "customer-proof-access-secret-longer-than-thirty-two-characters";
const fileId = "10000000-0000-4000-8000-000000000001";
const orderNumber = "RNR-2026-ABC123";

describe("customer proof request access", () => {
  it("prefers an exact signed proof link", () => {
    const expires = 1_900_000_000;
    const signature = signProofAccess({ orderNumber, fileId, expires }, secret);

    expect(resolveCustomerProofAccess({ orderNumber, fileId, expires, signature }, secret, new Date(0))).toEqual({
      kind: "signed",
      fileId,
    });
  });

  it("uses the authenticated customer or completed-checkout token when no proof signature is valid", () => {
    expect(resolveCustomerProofAccess({ orderNumber, userId: "customer-1" }, secret)).toEqual({
      kind: "customer",
      userId: "customer-1",
    });
    const token = createCheckoutSessionToken();
    expect(resolveCustomerProofAccess({ orderNumber, checkoutToken: token }, secret)).toEqual({
      kind: "checkout",
      tokenDigest: hashCheckoutSessionToken(token),
    });
  });

  it("fails closed for expired, malformed and ownerless requests", () => {
    const expires = 1_700_000_000;
    const signature = signProofAccess({ orderNumber, fileId, expires }, secret);
    expect(resolveCustomerProofAccess(
      { orderNumber, fileId, expires, signature },
      secret,
      new Date(expires * 1000),
    )).toBeNull();
    expect(resolveCustomerProofAccess({ orderNumber, checkoutToken: "bad" }, secret)).toBeNull();
    expect(resolveCustomerProofAccess({ orderNumber }, secret)).toBeNull();
  });
});
