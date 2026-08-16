import { describe, expect, it, vi } from "vitest";
import {
  createOrderNotificationService,
  type OrderNotificationRepository,
} from "./order-notification-service";
import type { CustomerEmailProvider } from "./customer-notification-service";
import { verifyOrderEmailAccessToken } from "@/server/orders/order-email-access";

const now = new Date("2026-08-06T02:00:00.000Z");
const orderAccessSecret = "order-email-access-secret-with-sufficient-entropy-12345";
const delivery = Object.freeze({
  id: "10000000-0000-4000-8000-000000000001",
  eventKey: "payment-confirmed:20000000-0000-4000-8000-000000000002",
  kind: "payment_confirmed" as const,
  orderId: "20000000-0000-4000-8000-000000000002",
  orderNumber: "RNR-2026-ABC123",
  customerName: "Aroha Ngata",
  recipientEmail: "aroha@example.test",
  currency: "NZD" as const,
  paymentStatus: "paid" as const,
  totalInclGstCents: 12_075,
  trackingNumber: null,
  trackingCarrier: null,
  trackingUrl: null,
  status: "sending" as const,
  attempts: 1,
  createdAt: now,
});

function repository(): OrderNotificationRepository {
  return {
    claimNext: vi.fn().mockResolvedValueOnce(delivery).mockResolvedValue(null),
    markSent: vi.fn().mockResolvedValue(true),
    markFailed: vi.fn().mockResolvedValue(true),
    discard: vi.fn().mockResolvedValue(true),
  };
}

describe("order notification delivery", () => {
  it("sends a durable payment confirmation without implying payment is pending", async () => {
    const repo = repository();
    const send = vi.fn().mockResolvedValue({ providerMessageId: "email-123" });
    const provider: CustomerEmailProvider = { configured: true, send };
    const service = createOrderNotificationService(repo, {
      provider,
      siteUrl: "https://shop.example.test",
      orderAccessSecret,
      now: () => now,
    });

    await expect(service.deliverPending(5)).resolves.toEqual({
      result: "processed",
      sent: 1,
      failed: 0,
    });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: delivery.recipientEmail,
      idempotencyKey: delivery.eventKey,
      subject: `Payment confirmed — ${delivery.orderNumber}`,
      text: expect.stringContaining("NZ$120.75"),
    }));
    const message = send.mock.calls[0][0];
    expect(message.text).toContain("Customer Service Team");
    expect(message.html).toContain("/media/brand/rr-gallery-logo-2026.webp");
    const orderUrl = new URL(message.text.match(/https:\/\/\S+/)?.[0] ?? "");
    expect(verifyOrderEmailAccessToken(
      orderUrl.searchParams.get("access"),
      delivery.orderNumber,
      orderAccessSecret,
      now,
    )).toBe(true);
    expect(repo.markSent).toHaveBeenCalledWith(delivery.id, "email-123", now);
  });

  it("leaves queued order messages untouched when email is not configured", async () => {
    const repo = repository();
    const service = createOrderNotificationService(repo, {
      provider: { configured: false, send: vi.fn() },
      siteUrl: "https://shop.example.test",
      orderAccessSecret,
    });

    await expect(service.deliverPending()).resolves.toEqual({
      result: "not_configured",
      sent: 0,
      failed: 0,
    });
    expect(repo.claimNext).not.toHaveBeenCalled();
  });

  it("uses the immutable AUD currency in Australian payment confirmations", async () => {
    const australianDelivery = { ...delivery, currency: "AUD" as const };
    const repo: OrderNotificationRepository = {
      ...repository(),
      claimNext: vi.fn().mockResolvedValueOnce(australianDelivery).mockResolvedValue(null),
    };
    const send = vi.fn().mockResolvedValue({ providerMessageId: "email-au-123" });
    const service = createOrderNotificationService(repo, {
      provider: { configured: true, send },
      siteUrl: "https://shop.example.test",
      orderAccessSecret,
      now: () => now,
    });

    await service.deliverPending();

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining("A$120.75 AUD"),
    }));
  });

  it("sends administrators a distinct paid-order notification", async () => {
    const adminDelivery = {
      ...delivery,
      eventKey: "admin-order-received:20000000-0000-4000-8000-000000000002:admin-1",
      kind: "admin_order_received" as const,
      recipientEmail: "owner@example.test",
    };
    const repo: OrderNotificationRepository = {
      ...repository(),
      claimNext: vi.fn().mockResolvedValueOnce(adminDelivery).mockResolvedValue(null),
    };
    const send = vi.fn().mockResolvedValue({ providerMessageId: "email-admin-123" });
    const service = createOrderNotificationService(repo, {
      provider: { configured: true, send },
      siteUrl: "https://shop.example.test",
      orderAccessSecret,
      now: () => now,
    });

    await service.deliverPending();

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: adminDelivery.recipientEmail,
      subject: `New paid order — ${adminDelivery.orderNumber}`,
      text: expect.stringContaining(`/admin/orders/${adminDelivery.orderId}`),
    }));
    const message = send.mock.calls[0][0];
    expect(message.text).not.toContain("Customer Service Team");
    expect(message.html).not.toContain("/media/brand/rr-gallery-logo-2026.webp");
  });

  it("adds the customer signature to payment-failure emails", async () => {
    const failedDelivery = {
      ...delivery,
      kind: "payment_failed" as const,
      paymentStatus: "failed" as const,
    };
    const repo: OrderNotificationRepository = {
      ...repository(),
      claimNext: vi.fn().mockResolvedValueOnce(failedDelivery).mockResolvedValue(null),
    };
    const send = vi.fn().mockResolvedValue({ providerMessageId: "email-failed-123" });
    const service = createOrderNotificationService(repo, {
      provider: { configured: true, send },
      siteUrl: "https://shop.example.test",
      orderAccessSecret,
      now: () => now,
    });

    await service.deliverPending();

    expect(send.mock.calls[0][0].text).toContain("Customer Service Team");
    expect(send.mock.calls[0][0].html).toContain(
      "https://shop.example.test/media/brand/rr-gallery-logo-2026.webp",
    );
  });

  it("adds the customer signature to shipped-order emails", async () => {
    const shippedDelivery = {
      ...delivery,
      kind: "order_shipped" as const,
      trackingNumber: "TRACK-123",
      trackingCarrier: "NZ Post",
      trackingUrl: "https://tracking.example.test/TRACK-123",
    };
    const repo: OrderNotificationRepository = {
      ...repository(),
      claimNext: vi.fn().mockResolvedValueOnce(shippedDelivery).mockResolvedValue(null),
    };
    const send = vi.fn().mockResolvedValue({ providerMessageId: "email-shipped-123" });
    const service = createOrderNotificationService(repo, {
      provider: { configured: true, send },
      siteUrl: "https://shop.example.test",
      orderAccessSecret,
      now: () => now,
    });

    await service.deliverPending();

    expect(send.mock.calls[0][0]).toEqual(expect.objectContaining({
      idempotencyKey: shippedDelivery.eventKey,
      text: expect.stringContaining("Customer Service Team"),
      html: expect.stringContaining("/media/brand/rr-gallery-logo-2026.webp"),
    }));
  });

  it("renders published wording without changing protected delivery data", async () => {
    const customizedDelivery = {
      ...delivery,
      customerName: "Aroha <script>alert(1)</script>",
    };
    const repo: OrderNotificationRepository = {
      ...repository(),
      claimNext: vi.fn().mockResolvedValueOnce(customizedDelivery).mockResolvedValue(null),
    };
    const send = vi.fn().mockResolvedValue({ providerMessageId: "email-custom-123" });
    const loadPublishedTemplates = vi.fn().mockResolvedValue({
      "email.payment_confirmed.subject": "Receipt — {{order_number}}",
      "email.payment_confirmed.body": "Hello {{customer_name}}.\n\nWe received {{amount}}.",
      "email.payment_confirmed.action_label": "See receipt",
    });
    const loadPublishedSignature = vi.fn().mockResolvedValue({
      "email.signature.team_name": "R&R Customer Care",
    });
    const service = createOrderNotificationService(repo, {
      provider: { configured: true, send },
      siteUrl: "https://shop.example.test",
      orderAccessSecret,
      loadPublishedTemplates,
      loadPublishedSignature,
      now: () => now,
    });

    await service.deliverPending();

    const message = send.mock.calls[0][0];
    expect(message).toEqual(expect.objectContaining({
      to: customizedDelivery.recipientEmail,
      idempotencyKey: customizedDelivery.eventKey,
      subject: `Receipt — ${customizedDelivery.orderNumber}`,
      text: expect.stringContaining("We received NZ$120.75."),
    }));
    expect(message.text).toContain("See receipt: https://shop.example.test/orders/");
    expect(message.html).toContain("Aroha &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(message.html).not.toContain("<script>");
    expect(message.text).toContain("R&R Customer Care");
    const orderUrl = new URL(message.text.match(/https:\/\/\S+/)?.[0] ?? "");
    expect(verifyOrderEmailAccessToken(
      orderUrl.searchParams.get("access"),
      customizedDelivery.orderNumber,
      orderAccessSecret,
      now,
    )).toBe(true);
    expect(loadPublishedTemplates).toHaveBeenCalledTimes(1);
    expect(loadPublishedSignature).toHaveBeenCalledTimes(1);
  });

  it("falls back to code defaults when published templates cannot be read", async () => {
    const repo = repository();
    const send = vi.fn().mockResolvedValue({ providerMessageId: "email-fallback-123" });
    const service = createOrderNotificationService(repo, {
      provider: { configured: true, send },
      siteUrl: "https://shop.example.test",
      orderAccessSecret,
      loadPublishedTemplates: vi.fn().mockRejectedValue(new Error("database unavailable")),
      now: () => now,
    });

    await expect(service.deliverPending()).resolves.toEqual({
      result: "processed",
      sent: 1,
      failed: 0,
    });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      subject: `Payment confirmed — ${delivery.orderNumber}`,
      text: expect.stringContaining("Production normally takes 5 business days"),
    }));
  });

  it("loads published templates once for a delivery batch", async () => {
    const secondDelivery = {
      ...delivery,
      id: "10000000-0000-4000-8000-000000000002",
      eventKey: "payment-confirmed:20000000-0000-4000-8000-000000000003",
      orderId: "20000000-0000-4000-8000-000000000003",
      orderNumber: "RNR-2026-DEF456",
    };
    const repo: OrderNotificationRepository = {
      ...repository(),
      claimNext: vi.fn()
        .mockResolvedValueOnce(delivery)
        .mockResolvedValueOnce(secondDelivery)
        .mockResolvedValue(null),
    };
    const send = vi.fn().mockResolvedValue({ providerMessageId: "email-batch-123" });
    const loadPublishedTemplates = vi.fn().mockResolvedValue({
      "email.payment_confirmed.subject": "Receipt — {{order_number}}",
    });
    const service = createOrderNotificationService(repo, {
      provider: { configured: true, send },
      siteUrl: "https://shop.example.test",
      orderAccessSecret,
      loadPublishedTemplates,
      now: () => now,
    });

    await service.deliverPending(5);

    expect(send).toHaveBeenCalledTimes(2);
    expect(loadPublishedTemplates).toHaveBeenCalledTimes(1);
  });

  it("discards an obsolete payment failure after the order becomes paid", async () => {
    const staleFailure = {
      ...delivery,
      eventKey: "payment-failed:30000000-0000-4000-8000-000000000003",
      kind: "payment_failed" as const,
      paymentStatus: "paid" as const,
    };
    const repo: OrderNotificationRepository = {
      ...repository(),
      claimNext: vi.fn().mockResolvedValueOnce(staleFailure).mockResolvedValue(null),
    };
    const send = vi.fn();
    const service = createOrderNotificationService(repo, {
      provider: { configured: true, send },
      siteUrl: "https://shop.example.test",
      orderAccessSecret,
      now: () => now,
    });

    await expect(service.deliverPending()).resolves.toEqual({
      result: "processed",
      sent: 0,
      failed: 0,
    });
    expect(send).not.toHaveBeenCalled();
    expect(repo.discard).toHaveBeenCalledWith(staleFailure.id);
  });
});
