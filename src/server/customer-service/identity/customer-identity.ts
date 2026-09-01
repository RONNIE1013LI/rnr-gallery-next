import { createHmac } from "node:crypto";

export type CustomerInboxIdentity = Readonly<{
  kind:
    | "facebook_psid"
    | "website_authenticated_customer"
    | "website_stable_visitor"
    | "website_conversation";
  keyHash: string;
}>;

const hashPattern = /^[a-f0-9]{64}$/;

function exactHash(value: string) {
  if (!hashPattern.test(value)) {
    throw new Error("customer_inbox_identity_hash_invalid");
  }
  return value;
}

export function authenticatedWebsiteCustomerHash(customerId: string, secret: string) {
  const normalizedCustomerId = customerId.trim();
  if (!normalizedCustomerId || normalizedCustomerId.length > 512) {
    throw new Error("customer_inbox_authenticated_customer_invalid");
  }
  if (secret.length < 32) {
    throw new Error("customer_inbox_identity_secret_invalid");
  }
  return createHmac("sha256", secret)
    .update(`website-inbox-customer\0${normalizedCustomerId}`)
    .digest("hex");
}

export function resolveFacebookInboxIdentity(externalPsidHash: string): CustomerInboxIdentity {
  return Object.freeze({
    kind: "facebook_psid",
    keyHash: exactHash(externalPsidHash),
  });
}

export function resolveWebsiteInboxIdentity(input: Readonly<{
  authenticatedCustomerId: string | null;
  stableVisitorDigest: string | null;
  technicalConversationHash: string;
  secret: string;
}>): CustomerInboxIdentity {
  if (input.authenticatedCustomerId !== null) {
    return Object.freeze({
      kind: "website_authenticated_customer",
      keyHash: authenticatedWebsiteCustomerHash(input.authenticatedCustomerId, input.secret),
    });
  }
  if (input.stableVisitorDigest !== null) {
    return Object.freeze({
      kind: "website_stable_visitor",
      keyHash: exactHash(input.stableVisitorDigest),
    });
  }
  return Object.freeze({
    kind: "website_conversation",
    keyHash: exactHash(input.technicalConversationHash),
  });
}
