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
} from "./review-alert-service";

const now = new Date("2026-08-21T00:00:00.000Z");
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

function setup() {
  const repository = {
    claimDueReviewAlert: vi.fn(async () => delivery()),
    markReviewAlertSent: vi.fn(async () => true),
    retryReviewAlert: vi.fn(async () => true),
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
    siteUrl: "https://rrgallery.example",
    deepLinkSecret: "review-link-secret-at-least-32-bytes",
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
});
