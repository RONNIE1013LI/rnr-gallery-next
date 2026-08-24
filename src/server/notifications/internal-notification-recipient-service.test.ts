import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { CustomerEmailMessage } from "./customer-notification-service";
import {
  InternalNotificationRecipientConflictError,
  createInternalNotificationRecipientService,
  normalizeInternalNotificationEmail,
  type InternalNotificationRecipientRepository,
  type InternalNotificationRecipientView,
} from "./internal-notification-recipient-service";

const now = new Date("2026-08-24T02:00:00.000Z");
const rawToken = Buffer.alloc(32, 7).toString("base64url");
const actor = Object.freeze({ userId: "admin-1", email: "ADMIN@Example.com" });

function recipient(overrides: Partial<InternalNotificationRecipientView> = {}): InternalNotificationRecipientView {
  return Object.freeze({
    id: "87b8c9f4-116d-4f2e-8cb2-17133c833e5a",
    email: "orders@example.com",
    status: "pending_verification",
    topics: ["web_order_paid"] as const,
    createdAt: now,
    verifiedAt: null,
    verificationExpiresAt: new Date("2026-08-25T02:00:00.000Z"),
    disabledAt: null,
    ...overrides,
  });
}

function repository(overrides: Partial<InternalNotificationRecipientRepository> = {}) {
  return {
    list: vi.fn(async () => []),
    createPending: vi.fn(async () => recipient()),
    reissueVerification: vi.fn(async () => recipient()),
    verify: vi.fn(async () => recipient({ status: "active", verifiedAt: now, verificationExpiresAt: null })),
    replaceSubscriptions: vi.fn(async () => recipient()),
    disable: vi.fn(async () => recipient({ status: "disabled", disabledAt: now, verificationExpiresAt: null })),
    ...overrides,
  } satisfies InternalNotificationRecipientRepository;
}

function service(repo = repository(), provider = { configured: true, send: vi.fn(async () => ({ providerMessageId: "email-1" })) }) {
  return {
    repo,
    provider,
    service: createInternalNotificationRecipientService(repo, {
      provider,
      siteUrl: "https://rrgallery.co.nz",
      now: () => now,
      createToken: () => rawToken,
    }),
  };
}

describe("internal notification recipient service", () => {
  it("normalizes arbitrary valid email addresses", () => {
    expect(normalizeInternalNotificationEmail("  Orders+AU@Example.COM ")).toBe("orders+au@example.com");
    expect(() => normalizeInternalNotificationEmail("not-an-email")).toThrow("Invalid recipient email");
  });

  it("creates a pending recipient with exact topics, a SHA-256 digest, and 24-hour expiry", async () => {
    const { service: subject, repo, provider } = service();

    const result = await subject.add(actor, {
      email: "  Orders@Example.COM ",
      topics: ["web_order_paid"],
      idempotencyKey: "recipient-create-1",
    });

    expect(result).toEqual({ recipient: recipient(), verificationDelivery: "sent" });
    expect(repo.createPending).toHaveBeenCalledWith({
      actor: { userId: "admin-1", email: "admin@example.com" },
      email: "orders@example.com",
      topics: ["web_order_paid"],
      verificationTokenDigest: createHash("sha256").update(rawToken).digest("hex"),
      verificationIssuedAt: now,
      verificationExpiresAt: new Date("2026-08-25T02:00:00.000Z"),
      idempotencyKey: "recipient-create-1",
    });
    expect(provider.send).toHaveBeenCalledWith(expect.objectContaining({
      to: "orders@example.com",
      idempotencyKey: expect.stringContaining("internal-recipient-verification:"),
    }));
    expect(JSON.stringify(result)).not.toContain(rawToken);
  });

  it("rejects duplicate topics, unknown topics, and empty subscriptions before persistence", async () => {
    const { service: subject, repo } = service();

    await expect(subject.add(actor, {
      email: "orders@example.com",
      topics: [],
      idempotencyKey: "empty-topics",
    })).rejects.toThrow("Select at least one notification topic");
    await expect(subject.add(actor, {
      email: "orders@example.com",
      topics: ["web_order_paid", "web_order_paid"],
      idempotencyKey: "duplicate-topics",
    })).rejects.toThrow("Notification topics must be unique");
    await expect(subject.add(actor, {
      email: "orders@example.com",
      topics: ["customer_email" as "web_order_paid"],
      idempotencyKey: "unknown-topic",
    })).rejects.toThrow("Invalid notification recipient input");
    expect(repo.createPending).not.toHaveBeenCalled();
  });

  it("preserves duplicate-recipient conflicts from the repository", async () => {
    const duplicate = new InternalNotificationRecipientConflictError("Recipient already exists");
    const { service: subject } = service(repository({
      createPending: vi.fn(async () => { throw duplicate; }),
    }));

    await expect(subject.add(actor, {
      email: "orders@example.com",
      topics: ["manual_order_created"],
      idempotencyKey: "duplicate-recipient",
    })).rejects.toBe(duplicate);
  });

  it("keeps pending state when the verification provider fails or is not configured", async () => {
    const failedProvider = { configured: true, send: vi.fn(async () => { throw new Error("provider body must not leak"); }) };
    const unavailableProvider = { configured: false, send: vi.fn(async () => { throw new Error("not configured"); }) };
    const failed = service(repository(), failedProvider);
    const unavailable = service(repository(), unavailableProvider);
    const input = { email: "orders@example.com", topics: ["proof_approved"] as const, idempotencyKey: "delivery-safe" };

    await expect(failed.service.add(actor, input)).resolves.toEqual({
      recipient: recipient(), verificationDelivery: "failed",
    });
    await expect(unavailable.service.add(actor, input)).resolves.toEqual({
      recipient: recipient(), verificationDelivery: "not_configured",
    });
    expect(failed.repo.createPending).toHaveBeenCalledOnce();
    expect(unavailable.repo.createPending).toHaveBeenCalledOnce();
  });

  it("reissues with a new digest before delivery and never returns the raw token", async () => {
    const { service: subject, repo } = service();

    const result = await subject.resendVerification(actor, {
      recipientId: recipient().id,
      idempotencyKey: "reissue-1",
    });

    expect(repo.reissueVerification).toHaveBeenCalledWith({
      actor: { userId: "admin-1", email: "admin@example.com" },
      recipientId: recipient().id,
      verificationTokenDigest: createHash("sha256").update(rawToken).digest("hex"),
      verificationIssuedAt: now,
      verificationExpiresAt: new Date("2026-08-25T02:00:00.000Z"),
      idempotencyKey: "reissue-1",
    });
    expect(JSON.stringify(result)).not.toContain(rawToken);
  });

  it("uses different non-sensitive provider idempotency keys for different tokens issued at the same time", async () => {
    const firstToken = Buffer.alloc(32, 11).toString("base64url");
    const secondToken = Buffer.alloc(32, 12).toString("base64url");
    const createToken = vi.fn()
      .mockReturnValueOnce(firstToken)
      .mockReturnValueOnce(secondToken);
    const repo = repository();
    const send = vi.fn(async (message: CustomerEmailMessage) => ({ providerMessageId: message.to }));
    const subject = createInternalNotificationRecipientService(repo, {
      provider: { configured: true, send },
      siteUrl: "https://rrgallery.co.nz",
      now: () => now,
      createToken,
    });

    await subject.resendVerification(actor, {
      recipientId: recipient().id,
      idempotencyKey: "same-clock-first",
    });
    await subject.resendVerification(actor, {
      recipientId: recipient().id,
      idempotencyKey: "same-clock-second",
    });

    const keys = send.mock.calls.map(([message]) => message.idempotencyKey);
    expect(keys).toEqual([
      `internal-recipient-verification:${recipient().id}:d4f235e0d9d4aa54ff116724a7e17c1802d74018c0995cd60de5b8477386b9e2`,
      `internal-recipient-verification:${recipient().id}:f51176ef958dc042f2f952ebf5bec7ae150503b4f0999eb1de136d56432dce5c`,
    ]);
    expect(JSON.stringify(keys)).not.toContain(firstToken);
    expect(JSON.stringify(keys)).not.toContain(secondToken);
  });

  it("hashes opaque tokens for single-use repository verification", async () => {
    const { service: subject, repo } = service();

    await subject.verify(rawToken);

    expect(repo.verify).toHaveBeenCalledWith({
      verificationTokenDigest: createHash("sha256").update(rawToken).digest("hex"),
      now,
    });
  });

  it("validates and replaces the entire subscription set", async () => {
    const updated = recipient({ topics: ["manual_order_created", "proof_changes_requested"] });
    const { service: subject, repo } = service(repository({
      replaceSubscriptions: vi.fn(async () => updated),
    }));

    await expect(subject.updateSubscriptions(actor, {
      recipientId: recipient().id,
      topics: ["manual_order_created", "proof_changes_requested"],
      idempotencyKey: "subscriptions-1",
    })).resolves.toEqual(updated);
    expect(repo.replaceSubscriptions).toHaveBeenCalledWith({
      actor: { userId: "admin-1", email: "admin@example.com" },
      recipientId: recipient().id,
      topics: ["manual_order_created", "proof_changes_requested"],
      idempotencyKey: "subscriptions-1",
      now,
    });
  });

  it("delegates idempotent disable without exposing verification material", async () => {
    const disabled = recipient({ status: "disabled", disabledAt: now, verificationExpiresAt: null });
    const { service: subject, repo } = service(repository({ disable: vi.fn(async () => disabled) }));

    const result = await subject.disable(actor, {
      recipientId: recipient().id,
      idempotencyKey: "disable-1",
    });

    expect(result).toEqual(disabled);
    expect(repo.disable).toHaveBeenCalledWith({
      actor: { userId: "admin-1", email: "admin@example.com" },
      recipientId: recipient().id,
      idempotencyKey: "disable-1",
      now,
    });
    expect(JSON.stringify(result)).not.toContain(rawToken);
  });

  it("lists only the Admin-safe recipient projection", async () => {
    const safe = recipient();
    const { service: subject } = service(repository({ list: vi.fn(async () => [safe]) }));

    const result = await subject.list();

    expect(result).toEqual([safe]);
    expect(Object.keys(result[0] ?? {})).toEqual([
      "id", "email", "status", "topics", "createdAt", "verifiedAt",
      "verificationExpiresAt", "disabledAt",
    ]);
    expect(JSON.stringify(result)).not.toContain(rawToken);
  });
});
