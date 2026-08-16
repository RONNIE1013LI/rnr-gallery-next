import { describe, expect, it, vi } from "vitest";
import {
  createOrderNotificationService,
  type OrderNotificationRepository,
} from "./order-notification-service";
import type { CustomerEmailProvider } from "./customer-notification-service";

const now = new Date("2026-08-06T02:00:00.000Z");
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
    expect(repo.markSent).toHaveBeenCalledWith(delivery.id, "email-123", now);
  });

  it("leaves queued order messages untouched when email is not configured", async () => {
    const repo = repository();
    const service = createOrderNotificationService(repo, {
      provider: { configured: false, send: vi.fn() },
      siteUrl: "https://shop.example.test",
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
      now: () => now,
    });

    await service.deliverPending();

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: adminDelivery.recipientEmail,
      subject: `New paid order — ${adminDelivery.orderNumber}`,
      text: expect.stringContaining(`/admin/orders/${adminDelivery.orderId}`),
    }));
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
