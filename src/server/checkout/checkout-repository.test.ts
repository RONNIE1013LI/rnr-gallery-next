import { describe, expect, it, vi } from "vitest";
import type {
  CheckoutRepository,
  CheckoutSessionRecord,
} from "./checkout-repository";
import {
  assertOwnedUploadReferences,
  ensureCheckoutSession,
  UnownedUploadReferenceError,
} from "./checkout-repository";
import { hashCheckoutSessionToken } from "./session-cookie";

const now = new Date("2026-08-02T00:00:00.000Z");

function session(
  overrides: Partial<CheckoutSessionRecord> = {},
): CheckoutSessionRecord {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    tokenDigest: hashCheckoutSessionToken("existing-token"),
    customerId: null,
    expiresAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

function repository(
  overrides: Partial<CheckoutRepository> = {},
): CheckoutRepository {
  return {
    findActiveSessionByTokenDigest: vi.fn().mockResolvedValue(null),
    createSession: vi.fn().mockImplementation(async (input) => session(input)),
    bindGuestSessionToCustomer: vi.fn().mockResolvedValue(null),
    createUpload: vi.fn(),
    findOwnedUploadIds: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("ensureCheckoutSession", () => {
  it("creates a digest-only guest session and returns a new opaque cookie token", async () => {
    const repo = repository();

    const result = await ensureCheckoutSession({
      repository: repo,
      rawToken: null,
      customerId: null,
      now,
      createToken: () => "new-token",
    });

    expect(repo.createSession).toHaveBeenCalledWith({
      tokenDigest: hashCheckoutSessionToken("new-token"),
      customerId: null,
      expiresAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    expect(result.cookieToken).toBe("new-token");
  });

  it("reuses a matching guest session without replacing its cookie", async () => {
    const existing = session();
    const repo = repository({
      findActiveSessionByTokenDigest: vi.fn().mockResolvedValue(existing),
    });

    await expect(
      ensureCheckoutSession({
        repository: repo,
        rawToken: "existing-token",
        customerId: null,
        now,
      }),
    ).resolves.toEqual({ session: existing, cookieToken: null });
    expect(repo.createSession).not.toHaveBeenCalled();
  });

  it("binds a guest checkout to the current signed-in customer", async () => {
    const existing = session();
    const bound = session({ customerId: "customer-a" });
    const repo = repository({
      findActiveSessionByTokenDigest: vi.fn().mockResolvedValue(existing),
      bindGuestSessionToCustomer: vi.fn().mockResolvedValue(bound),
    });

    await expect(
      ensureCheckoutSession({
        repository: repo,
        rawToken: "existing-token",
        customerId: "customer-a",
        now,
      }),
    ).resolves.toEqual({ session: bound, cookieToken: null });
  });

  it.each([
    ["a signed-in session after sign-out", null, "customer-a"],
    ["another customer's session", "customer-b", "customer-a"],
  ])("rotates %s rather than exposing it", async (_name, customerId, ownerId) => {
    const repo = repository({
      findActiveSessionByTokenDigest: vi
        .fn()
        .mockResolvedValue(session({ customerId: ownerId })),
    });

    const result = await ensureCheckoutSession({
      repository: repo,
      rawToken: "existing-token",
      customerId,
      now,
      createToken: () => "replacement-token",
    });

    expect(result.cookieToken).toBe("replacement-token");
    expect(repo.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerId }),
    );
  });
});

describe("assertOwnedUploadReferences", () => {
  it("allows send-after-ordering with no upload references", async () => {
    const repo = repository();
    await expect(
      assertOwnedUploadReferences(repo, session().id, []),
    ).resolves.toBeUndefined();
    expect(repo.findOwnedUploadIds).not.toHaveBeenCalled();
  });

  it("rejects missing and cross-session upload references", async () => {
    const repo = repository({
      findOwnedUploadIds: vi.fn().mockResolvedValue(["upload-a"]),
    });

    await expect(
      assertOwnedUploadReferences(repo, session().id, ["upload-a", "upload-b"]),
    ).rejects.toBeInstanceOf(UnownedUploadReferenceError);
  });
});
