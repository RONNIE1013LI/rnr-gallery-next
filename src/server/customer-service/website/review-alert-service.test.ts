import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  EmailDeliveryError,
  type CustomerEmailProvider,
} from "@/server/notifications/customer-notification-service";
import {
  createReviewAlertService,
  createReviewAlertToken,
  hashReviewAlertToken,
  type WebsiteReviewAlertRepository,
} from "./review-alert-service";

const now = new Date("2026-08-21T00:00:00.000Z");
const providerScopeFingerprint = "a1".repeat(32);
const rawToken = createReviewAlertToken({
  reviewId: "00000000-0000-4000-8000-000000000001",
  secret: "review-link-secret-at-least-32-bytes",
});

function delivery(overrides: Partial<{
  attemptCount: number;
  reason: "high_risk" | "unresolved" | "realtime_required" | "provider_error" | "output_blocked" | "budget_blocked" | "system_failure";
  redactedSummary: string;
}> = {}) {
  return {
    id: "outbox-1",
    humanReviewId: "00000000-0000-4000-8000-000000000001",
    idempotencyKey: "review-alert:00000000-0000-4000-8000-000000000001",
    attemptCount: 1,
    leaseToken: "lease-1",
    reason: "realtime_required" as const,
    redactedSummary: "Please quote for 123 Main Street, customer@example.test, order RNR-123.",
    openedAt: now,
    deepLinkExpiresAt: new Date("2026-08-28T00:00:00.000Z"),
    ...overrides,
  };
}

function setup(scopeFingerprint = providerScopeFingerprint) {
  const repository = {
    claimDueReviewAlert: vi.fn(async () => delivery()),
    confirmClaimedReviewAlert: vi.fn(async () => true),
    beginClaimedReviewAlertSend: vi.fn<WebsiteReviewAlertRepository["beginClaimedReviewAlertSend"]>(
      async () => "send",
    ),
    markReviewAlertSent: vi.fn(async () => true),
    retryReviewAlert: vi.fn<WebsiteReviewAlertRepository["retryReviewAlert"]>(async () => "retry_wait"),
    markReviewAlertUncertain: vi.fn(async () => true),
  };
  const provider = {
    configured: true,
    send: vi.fn<CustomerEmailProvider["send"]>(async () => ({ providerMessageId: "resend-1" })),
  };
  const service = createReviewAlertService({
    repository,
    provider,
    alertTo: "staff@rrgallery.example",
    providerFrom: "R&R Gallery <support@rrgallery.example>",
    siteUrl: "https://rrgallery.example",
    deepLinkSecret: "review-link-secret-at-least-32-bytes",
    providerScopeFingerprint: scopeFingerprint,
    now: () => now,
  });
  return { repository, provider, service };
}

describe("website human-review alert delivery", () => {
  it("stores only a SHA-256 digest for the seven-day opaque deep-link token", () => {
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashReviewAlertToken(rawToken)).toBe(createHash("sha256").update(rawToken).digest("hex"));
    expect(hashReviewAlertToken(rawToken)).not.toContain(rawToken);
  });

  it("delivers one redacted, bounded staff alert with the stable Resend idempotency key", async () => {
    const current = setup();

    await expect(current.service.deliverNext()).resolves.toEqual({ result: "sent" });

    expect(current.provider.send).toHaveBeenCalledOnce();
    expect(current.repository.confirmClaimedReviewAlert).toHaveBeenCalledWith({
      id: "outbox-1",
      leaseToken: "lease-1",
      now,
    });
    expect(current.repository.beginClaimedReviewAlertSend).toHaveBeenCalledWith({
      id: "outbox-1",
      leaseToken: "lease-1",
      payloadDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      now,
    });
    expect(current.provider.send).toHaveBeenCalledWith(expect.objectContaining({
      to: "staff@rrgallery.example",
      idempotencyKey: "review-alert:00000000-0000-4000-8000-000000000001",
    }));
    const message = current.provider.send.mock.calls[0][0];
    expect(`${message.text}\n${message.html}`).toContain("Website");
    expect(`${message.text}\n${message.html}`).toContain("realtime_required");
    expect(`${message.text}\n${message.html}`).toContain(`/reply-assistant?review=${rawToken}`);
    expect(`${message.text}\n${message.html}`).not.toContain("customer@example.test");
    expect(`${message.text}\n${message.html}`).not.toContain("123 Main Street");
    expect(`${message.text}\n${message.html}`).not.toContain("RNR-123");
    expect(`${message.text}\n${message.html}`).not.toContain("outbox-1");
    expect(current.repository.markReviewAlertSent).toHaveBeenCalledWith({
      id: "outbox-1",
      leaseToken: "lease-1",
      providerMessageId: "resend-1",
      now,
    });
  });

  it("linearizes a canonical digest of every Resend idempotency-relevant payload field", async () => {
    const current = setup();

    await current.service.deliverNext();

    const message = current.provider.send.mock.calls[0][0];
    const expectedDigest = createHash("sha256").update(JSON.stringify({
      from: "R&R Gallery <support@rrgallery.example>",
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
      idempotencyKey: message.idempotencyKey,
      providerScopeFingerprint,
    })).digest("hex");
    expect(current.repository.beginClaimedReviewAlertSend).toHaveBeenCalledWith(expect.objectContaining({
      payloadDigest: expectedDigest,
    }));
  });

  it("binds provider scope into the final digest without leaking the standalone fingerprint", async () => {
    const first = setup("a1".repeat(32));
    const second = setup("b2".repeat(32));

    await first.service.deliverNext();
    await second.service.deliverNext();

    const firstDigest = first.repository.beginClaimedReviewAlertSend.mock.calls[0][0].payloadDigest;
    const secondDigest = second.repository.beginClaimedReviewAlertSend.mock.calls[0][0].payloadDigest;
    expect(firstDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(secondDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(firstDigest).not.toBe(secondDigest);
    expect(JSON.stringify(first.provider.send.mock.calls[0][0])).not.toContain("a1".repeat(32));
    expect(JSON.stringify(second.provider.send.mock.calls[0][0])).not.toContain("b2".repeat(32));
  });

  it("stops before the provider when durable linearization detects payload config drift", async () => {
    const current = setup();
    current.repository.beginClaimedReviewAlertSend.mockResolvedValueOnce("payload_mismatch");

    await expect(current.service.deliverNext()).resolves.toEqual({ result: "uncertain" });

    expect(current.provider.send).not.toHaveBeenCalled();
    expect(current.repository.retryReviewAlert).not.toHaveBeenCalled();
    expect(current.repository.markReviewAlertUncertain).not.toHaveBeenCalled();
  });

  it("does not call the provider when manual resolution terminalizes the claimed alert", async () => {
    const current = setup();
    current.repository.confirmClaimedReviewAlert.mockResolvedValueOnce(false);

    await expect(current.service.deliverNext()).resolves.toEqual({ result: "resolved" });

    expect(current.provider.send).not.toHaveBeenCalled();
    expect(current.repository.markReviewAlertSent).not.toHaveBeenCalled();
    expect(current.repository.retryReviewAlert).not.toHaveBeenCalled();
    expect(current.repository.markReviewAlertUncertain).not.toHaveBeenCalled();
  });

  it("does not call the provider when manual resolution wins after confirmation but before send linearization", async () => {
    const current = setup();
    let manuallyResolved = false;
    current.repository.confirmClaimedReviewAlert.mockImplementationOnce(async () => {
      manuallyResolved = true;
      return true;
    });
    current.repository.beginClaimedReviewAlertSend.mockImplementationOnce(async () => (
      manuallyResolved ? "resolved" as const : "send" as const
    ));

    await expect(current.service.deliverNext()).resolves.toEqual({ result: "resolved" });

    expect(current.repository.beginClaimedReviewAlertSend).toHaveBeenCalledOnce();
    expect(current.provider.send).not.toHaveBeenCalled();
    expect(current.repository.markReviewAlertSent).not.toHaveBeenCalled();
  });

  it("sends and settles when the worker durably linearizes before manual resolution", async () => {
    const current = setup();
    let manuallyResolved = false;
    current.repository.beginClaimedReviewAlertSend.mockImplementationOnce(async () => {
      manuallyResolved = true;
      return "send" as const;
    });
    current.provider.send.mockImplementationOnce(async () => {
      expect(manuallyResolved).toBe(true);
      return { providerMessageId: "resend-linearized" };
    });

    await expect(current.service.deliverNext()).resolves.toEqual({ result: "sent" });

    expect(current.provider.send).toHaveBeenCalledOnce();
    expect(current.repository.markReviewAlertSent).toHaveBeenCalledWith({
      id: "outbox-1",
      leaseToken: "lease-1",
      providerMessageId: "resend-linearized",
      now,
    });
  });

  it("reports resolved instead of retrying when manual resolution follows linearization and provider failure", async () => {
    const current = setup();
    current.provider.send.mockRejectedValueOnce(new EmailDeliveryError("rate_limited"));
    current.repository.retryReviewAlert.mockResolvedValueOnce("resolved");

    await expect(current.service.deliverNext()).resolves.toEqual({ result: "resolved" });

    expect(current.provider.send).toHaveBeenCalledOnce();
    expect(current.repository.retryReviewAlert).toHaveBeenCalledOnce();
  });

  it("does not retry after provider success when sent settlement fails", async () => {
    const current = setup();
    current.repository.markReviewAlertSent.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(current.service.deliverNext()).rejects.toThrow("database unavailable");

    expect(current.provider.send).toHaveBeenCalledOnce();
    expect(current.repository.retryReviewAlert).not.toHaveBeenCalled();
    expect(current.repository.markReviewAlertUncertain).not.toHaveBeenCalled();
  });

  it("excludes every customer-authored value from an alert email", async () => {
    const unsafeValues = [
      "021.234.5678",
      "7 Private Crescent, Wellington",
      "4111 1111 1111 1111",
      "sk_live_customer_secret",
      "11111111-1111-4111-8111-111111111111",
      "customer@example.test",
      "<script>customerHtml()</script>",
    ];
    const current = setup();
    current.repository.claimDueReviewAlert.mockResolvedValueOnce(delivery({
      redactedSummary: unsafeValues.join(" | "),
    }));

    await expect(current.service.deliverNext()).resolves.toEqual({ result: "sent" });

    const message = current.provider.send.mock.calls[0][0];
    const rendered = `${message.text}\n${message.html}`;
    for (const unsafeValue of unsafeValues) {
      expect(rendered).not.toContain(unsafeValue);
    }
    expect(rendered).toContain("realtime_required");
  });

  it("does not send and terminally settles a lease when the deep link expires after claim", async () => {
    const expiresAt = new Date("2026-08-21T00:00:01.000Z");
    const repository = {
      claimDueReviewAlert: vi.fn(async () => ({ ...delivery(), deepLinkExpiresAt: expiresAt })),
      confirmClaimedReviewAlert: vi.fn(async () => true),
      beginClaimedReviewAlertSend: vi.fn<WebsiteReviewAlertRepository["beginClaimedReviewAlertSend"]>(
        async () => "send",
      ),
      markReviewAlertSent: vi.fn(async () => true),
      retryReviewAlert: vi.fn(async () => "retry_wait" as const),
      markReviewAlertUncertain: vi.fn(async () => true),
    };
    const provider = {
      configured: true,
      send: vi.fn<CustomerEmailProvider["send"]>(async () => ({ providerMessageId: "resend-1" })),
    };
    const freshNow = vi.fn()
      .mockReturnValueOnce(new Date("2026-08-21T00:00:00.999Z"))
      .mockReturnValueOnce(expiresAt);
    const service = createReviewAlertService({
      repository,
      provider,
      alertTo: "staff@rrgallery.example",
      providerFrom: "R&R Gallery <support@rrgallery.example>",
      siteUrl: "https://rrgallery.example",
      deepLinkSecret: "review-link-secret-at-least-32-bytes",
      providerScopeFingerprint,
      now: freshNow,
    });

    await expect(service.deliverNext()).resolves.toEqual({ result: "expired" });

    expect(provider.send).not.toHaveBeenCalled();
    expect(repository.markReviewAlertUncertain).toHaveBeenCalledWith({
      id: "outbox-1",
      leaseToken: "lease-1",
      errorCode: "deep_link_expired_before_send",
      now: expiresAt,
    });
    expect(repository.markReviewAlertSent).not.toHaveBeenCalled();
    expect(repository.retryReviewAlert).not.toHaveBeenCalled();
  });

  it("retries known provider failures using the bounded retry schedule without affecting chat", async () => {
    const current = setup();
    current.provider.send.mockRejectedValueOnce(new EmailDeliveryError("rate_limited"));

    await expect(current.service.deliverNext()).resolves.toEqual({ result: "retry_wait" });

    expect(current.repository.retryReviewAlert).toHaveBeenCalledWith({
      id: "outbox-1",
      leaseToken: "lease-1",
      errorCode: "rate_limited",
      nextAttemptAt: new Date("2026-08-21T00:01:00.000Z"),
      now,
    });
  });

  it("does not automatically redeliver after a timeout or unknown provider result", async () => {
    const current = setup();
    current.provider.send.mockRejectedValueOnce(new EmailDeliveryError("network_error"));

    await expect(current.service.deliverNext()).resolves.toEqual({ result: "uncertain" });

    expect(current.repository.markReviewAlertUncertain).toHaveBeenCalledWith({
      id: "outbox-1",
      leaseToken: "lease-1",
      errorCode: "network_error",
      now,
    });
    expect(current.repository.retryReviewAlert).not.toHaveBeenCalled();
  });

  it("terminalizes Resend invalid_idempotent_request as an uncertain result", async () => {
    const current = setup();
    current.provider.send.mockRejectedValueOnce(new EmailDeliveryError("invalid_idempotent_request"));

    await expect(current.service.deliverNext()).resolves.toEqual({ result: "uncertain" });

    expect(current.repository.markReviewAlertUncertain).toHaveBeenCalledWith({
      id: "outbox-1",
      leaseToken: "lease-1",
      errorCode: "invalid_idempotent_request",
      now,
    });
    expect(current.repository.retryReviewAlert).not.toHaveBeenCalled();
  });
});
