import { describe, expect, it, vi } from "vitest";
import { EmailDeliveryError } from "./customer-notification-service";
import {
  createInternalNotificationService,
  type InternalNotificationDelivery,
  type InternalNotificationOutboxRepository,
} from "./internal-notification-service";

const now = new Date("2026-08-24T05:00:00.000Z");
const delivery: InternalNotificationDelivery = Object.freeze({
  id: "10000000-0000-4000-8000-000000000001",
  eventKey: "web_order_paid:20000000-0000-4000-8000-000000000002:30000000-0000-4000-8000-000000000003",
  topic: "web_order_paid",
  resourceReference: "ORDER-1042",
  recipientId: "30000000-0000-4000-8000-000000000003",
  recipientEmail: "ops@example.test",
  payload: {
    version: 1 as const,
    adminPath: "/admin/orders/20000000-0000-4000-8000-000000000002",
  },
  attempts: 1,
});

const aiHumanReviewDelivery: InternalNotificationDelivery = Object.freeze({
  id: "40000000-0000-4000-8000-000000000004",
  eventKey: "website_ai_human_review_required:review-id:recipient-id",
  topic: "website_ai_human_review_required",
  resourceReference:
    "Website chat requires human review (high_risk) at 2026-08-24T10:00:00.000Z",
  recipientId: "50000000-0000-4000-8000-000000000005",
  recipientEmail: "ops@example.test",
  payload: {
    version: 1 as const,
    adminPath: "/reply-assistant",
  },
  attempts: 1,
});

function repository(
  event: InternalNotificationDelivery | null = delivery,
): InternalNotificationOutboxRepository {
  return {
    claimNext: vi.fn().mockResolvedValueOnce(event).mockResolvedValue(null),
    isRecipientActive: vi.fn().mockResolvedValue(true),
    markSent: vi.fn().mockResolvedValue(true),
    markFailed: vi.fn().mockResolvedValue(true),
    cancel: vi.fn().mockResolvedValue(true),
  };
}

describe("internal notification delivery", () => {
  it("isolates one successful recipient from another recipient's failure and retry", async () => {
    const successful = Object.freeze({
      ...aiHumanReviewDelivery,
      id: "60000000-0000-4000-8000-000000000006",
      eventKey:
        "website_ai_human_review_required:40000000-0000-4000-8000-000000000004:60000000-0000-4000-8000-000000000006",
      recipientId: "60000000-0000-4000-8000-000000000006",
      recipientEmail: "successful@example.test",
    });
    const retrying = Object.freeze({
      ...aiHumanReviewDelivery,
      id: "70000000-0000-4000-8000-000000000007",
      eventKey:
        "website_ai_human_review_required:40000000-0000-4000-8000-000000000004:70000000-0000-4000-8000-000000000007",
      recipientId: "70000000-0000-4000-8000-000000000007",
      recipientEmail: "retrying@example.test",
    });
    const retried = Object.freeze({ ...retrying, attempts: 2 });
    const repo = repository(null);
    vi.mocked(repo.claimNext).mockReset()
      .mockResolvedValueOnce(successful)
      .mockResolvedValueOnce(retrying)
      .mockResolvedValueOnce(retried)
      .mockResolvedValue(null);
    const sendAttempts = new Map<string, number>();
    const send = vi.fn(async (message: Readonly<{ to: string }>) => {
      const attemptsForRecipient = (sendAttempts.get(message.to) ?? 0) + 1;
      sendAttempts.set(message.to, attemptsForRecipient);
      if (message.to === retrying.recipientEmail && attemptsForRecipient === 1) {
        throw new EmailDeliveryError("rate_limit_exceeded");
      }
      return { providerMessageId: `email-${message.to}-${attemptsForRecipient}` };
    });
    let currentTime = now;
    const service = createInternalNotificationService(repo, {
      provider: { configured: true, send },
      siteUrl: "https://rrgallery.co.nz",
      now: () => currentTime,
    });

    await expect(service.deliverPending(2)).resolves.toEqual({
      result: "processed",
      sent: 1,
      failed: 1,
    });
    expect(repo.markSent).toHaveBeenCalledTimes(1);
    expect(repo.markSent).toHaveBeenCalledWith(
      successful.id,
      "email-successful@example.test-1",
      now,
    );
    expect(repo.markFailed).toHaveBeenCalledTimes(1);
    expect(repo.markFailed).toHaveBeenCalledWith(
      retrying.id,
      "rate_limit_exceeded",
      new Date(now.getTime() + 5 * 60_000),
      now,
    );

    currentTime = new Date(now.getTime() + 5 * 60_000);
    await expect(service.deliverPending(2)).resolves.toEqual({
      result: "processed",
      sent: 1,
      failed: 0,
    });
    expect(send.mock.calls.filter(([message]) =>
      message.to === successful.recipientEmail)).toHaveLength(1);
    expect(send.mock.calls.filter(([message]) =>
      message.to === retrying.recipientEmail)).toHaveLength(2);
    expect(repo.markSent).toHaveBeenLastCalledWith(
      retrying.id,
      "email-retrying@example.test-2",
      currentTime,
    );
  });

  it("delivers a privacy-safe Website AI human-review message", async () => {
    const repo = repository(aiHumanReviewDelivery);
    const send = vi.fn().mockResolvedValue({ providerMessageId: "email-review" });
    const service = createInternalNotificationService(repo, {
      provider: { configured: true, send },
      siteUrl: "https://rrgallery.co.nz",
      now: () => now,
    });

    await expect(service.deliverPending()).resolves.toEqual({
      result: "processed",
      sent: 1,
      failed: 0,
    });
    expect(send).toHaveBeenCalledWith({
      to: "ops@example.test",
      subject: "Website AI assistant needs human review",
      text: [
        "Website AI assistant needs human review",
        "",
        "Reference: Website chat requires human review (high_risk) at 2026-08-24T10:00:00.000Z",
        "",
        "View in Admin: https://rrgallery.co.nz/reply-assistant",
      ].join("\n"),
      html: '<p><strong>Website AI assistant needs human review</strong></p><p>Reference: Website chat requires human review (high_risk) at 2026-08-24T10:00:00.000Z</p><p><a href="https://rrgallery.co.nz/reply-assistant">View in Admin</a></p>',
      idempotencyKey:
        "website_ai_human_review_required:review-id:recipient-id",
    });
    const renderedMessage = vi.mocked(send).mock.calls[0]?.[0];
    expect(`${renderedMessage?.text}\n${renderedMessage?.html}`).not.toMatch(
      /customer-authored message|customer@example\.test|\+64 21 555 0101|delivery address/i,
    );
  });

  it("sends a fixed internal message and marks it sent", async () => {
    const repo = repository();
    const send = vi.fn().mockResolvedValue({ providerMessageId: "email-1042" });
    const service = createInternalNotificationService(repo, {
      provider: { configured: true, send },
      siteUrl: "https://rrgallery.co.nz",
      now: () => now,
    });

    await expect(service.deliverPending(5)).resolves.toEqual({
      result: "processed",
      sent: 1,
      failed: 0,
    });
    expect(repo.isRecipientActive).toHaveBeenCalledWith(delivery.recipientId);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: delivery.recipientEmail,
      subject: "Website order paid",
      idempotencyKey: delivery.eventKey,
      text: expect.stringContaining("ORDER-1042"),
    }));
    expect(repo.markSent).toHaveBeenCalledWith(delivery.id, "email-1042", now);
    expect(repo.markFailed).not.toHaveBeenCalled();
    expect(repo.cancel).not.toHaveBeenCalled();
  });

  it("leaves queued rows untouched when the provider is not configured", async () => {
    const repo = repository();
    const service = createInternalNotificationService(repo, {
      provider: { configured: false, send: vi.fn() },
      siteUrl: "https://rrgallery.co.nz",
    });

    await expect(service.deliverPending()).resolves.toEqual({
      result: "not_configured",
      sent: 0,
      failed: 0,
    });
    expect(repo.claimNext).not.toHaveBeenCalled();
  });

  it("cancels a claimed row when the recipient was disabled before send", async () => {
    const repo = repository();
    vi.mocked(repo.isRecipientActive).mockResolvedValue(false);
    const send = vi.fn();
    const service = createInternalNotificationService(repo, {
      provider: { configured: true, send },
      siteUrl: "https://rrgallery.co.nz",
      now: () => now,
    });

    await expect(service.deliverPending()).resolves.toEqual({
      result: "processed",
      sent: 0,
      failed: 0,
    });
    expect(repo.cancel).toHaveBeenCalledWith(
      delivery.id,
      "recipient_disabled",
      now,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    [1, 5 * 60_000],
    [2, 30 * 60_000],
    [3, 2 * 60 * 60_000],
    [4, 12 * 60 * 60_000],
    [5, 24 * 60 * 60_000],
    [6, 24 * 60 * 60_000],
  ])("schedules attempt %i with the approved delay", async (attempts, delay) => {
    const failedDelivery = Object.freeze({ ...delivery, attempts });
    const repo = repository(failedDelivery);
    const service = createInternalNotificationService(repo, {
      provider: {
        configured: true,
        send: vi.fn().mockRejectedValue(new EmailDeliveryError("rate_limit_exceeded")),
      },
      siteUrl: "https://rrgallery.co.nz",
      now: () => now,
    });

    await expect(service.deliverPending()).resolves.toEqual({
      result: "processed",
      sent: 0,
      failed: 1,
    });
    expect(repo.markFailed).toHaveBeenCalledWith(
      delivery.id,
      "rate_limit_exceeded",
      new Date(now.getTime() + delay),
      now,
    );
  });

  it("stores only a safe provider error code for unknown failures", async () => {
    const repo = repository();
    const service = createInternalNotificationService(repo, {
      provider: {
        configured: true,
        send: vi.fn().mockRejectedValue(new Error("private provider response")),
      },
      siteUrl: "https://rrgallery.co.nz",
      now: () => now,
    });

    await service.deliverPending();

    expect(repo.markFailed).toHaveBeenCalledWith(
      delivery.id,
      "provider_error",
      new Date(now.getTime() + 5 * 60_000),
      now,
    );
  });

  it("bounds the batch size before claiming", async () => {
    const repo = repository(null);
    const service = createInternalNotificationService(repo, {
      provider: { configured: true, send: vi.fn() },
      siteUrl: "https://rrgallery.co.nz",
    });

    await service.deliverPending(0);
    expect(repo.claimNext).toHaveBeenCalledTimes(1);

    vi.mocked(repo.claimNext).mockClear();
    vi.mocked(repo.claimNext).mockResolvedValue(null);
    await service.deliverPending(1000);
    expect(repo.claimNext).toHaveBeenCalledTimes(1);
  });
});
