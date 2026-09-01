import { describe, expect, it } from "vitest";
import {
  authenticatedWebsiteCustomerHash,
  resolveFacebookInboxIdentity,
  resolveWebsiteInboxIdentity,
} from "./customer-identity";

const secret = "reply-assistant-identity-secret-at-least-32-bytes";
const visitorHash = "a".repeat(64);
const conversationHash = "b".repeat(64);

describe("authoritative customer Inbox identity", () => {
  it("prefers authenticated Website customer identity over a stable visitor", () => {
    const identity = resolveWebsiteInboxIdentity({
      authenticatedCustomerId: "customer-a",
      stableVisitorDigest: visitorHash,
      technicalConversationHash: conversationHash,
      secret,
    });

    expect(identity.kind).toBe("website_authenticated_customer");
    expect(identity.keyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.keyHash).not.toContain("customer-a");
    expect(Object.keys(identity).sort()).toEqual(["keyHash", "kind"]);
  });

  it("uses the consented stable visitor only when no authenticated customer exists", () => {
    expect(resolveWebsiteInboxIdentity({
      authenticatedCustomerId: null,
      stableVisitorDigest: visitorHash,
      technicalConversationHash: conversationHash,
      secret,
    })).toEqual({
      kind: "website_stable_visitor",
      keyHash: visitorHash,
    });
  });

  it("falls back to the exact technical conversation without fuzzy evidence", () => {
    expect(resolveWebsiteInboxIdentity({
      authenticatedCustomerId: null,
      stableVisitorDigest: null,
      technicalConversationHash: conversationHash,
      secret,
    })).toEqual({
      kind: "website_conversation",
      keyHash: conversationHash,
    });
  });

  it("keeps two authenticated customers separate and deterministic", () => {
    const first = authenticatedWebsiteCustomerHash("customer-a", secret);
    const firstAgain = authenticatedWebsiteCustomerHash("customer-a", secret);
    const second = authenticatedWebsiteCustomerHash("customer-b", secret);

    expect(firstAgain).toBe(first);
    expect(second).not.toBe(first);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("uses the existing exact Facebook PSID hash without exposing a PSID", () => {
    expect(resolveFacebookInboxIdentity("c".repeat(64))).toEqual({
      kind: "facebook_psid",
      keyHash: "c".repeat(64),
    });
  });

  it.each([
    ["stable visitor", { authenticatedCustomerId: null, stableVisitorDigest: "NOT-A-HASH", technicalConversationHash: conversationHash, secret }],
    ["technical conversation", { authenticatedCustomerId: null, stableVisitorDigest: null, technicalConversationHash: "d".repeat(63), secret }],
  ])("rejects malformed %s identity material", (_name, input) => {
    expect(() => resolveWebsiteInboxIdentity(input)).toThrow("customer_inbox_identity_hash_invalid");
  });

  it("rejects an empty authenticated customer instead of merging it", () => {
    expect(() => resolveWebsiteInboxIdentity({
      authenticatedCustomerId: "   ",
      stableVisitorDigest: visitorHash,
      technicalConversationHash: conversationHash,
      secret,
    })).toThrow("customer_inbox_authenticated_customer_invalid");
  });
});
