import { describe, expect, it, vi } from "vitest";
import type { CustomerEmailProvider } from "./customer-notification-service";
import {
  createPaymentRequestNotificationService,
  type PaymentRequestNotificationDelivery,
  type PaymentRequestNotificationRepository,
} from "./payment-request-notification-service";

const now = new Date("2026-08-19T01:00:00.000Z");
const customerDelivery = Object.freeze({
  id: "10000000-0000-4000-8000-000000000001",
  eventKey: "payment-request-confirmed:20000000-0000-4000-8000-000000000002",
  kind: "payment_request_confirmed" as const,
  paymentRequestId: "20000000-0000-4000-8000-000000000002",
  requestNumber: "PAY-2026-ABC123",
  description: "Outstanding balance",
  recipientName: "Aroha Ngata",
  recipientEmail: "aroha@example.test",
  currency: "NZD" as const,
  amountCents: 500,
  status: "sending" as const,
  attempts: 1,
  createdAt: now,
});

function repository(
  delivery: PaymentRequestNotificationDelivery = customerDelivery,
): PaymentRequestNotificationRepository {
  return {
    repairMissingPaidNotifications: vi.fn().mockResolvedValue(0),
    claimNext: vi.fn().mockResolvedValueOnce(delivery).mockResolvedValue(null),
    markSent: vi.fn().mockResolvedValue(true),
    markFailed: vi.fn().mockResolvedValue(true),
  };
}

describe("Payment Request notification delivery", () => {
  it("repairs missing paid notifications before claiming deliveries", async () => {
    const repairMissingPaidNotifications = vi.fn().mockResolvedValue(2);
    const repo = {
      ...repository(),
      repairMissingPaidNotifications,
    };
    const service = createPaymentRequestNotificationService(repo, {
      provider: {
        configured: true,
        send: vi.fn().mockResolvedValue({ providerMessageId: "email-repaired-1" }),
      },
      siteUrl: "https://shop.example.test",
      now: () => now,
    });

    await service.deliverPending(20);

    expect(repairMissingPaidNotifications).toHaveBeenCalledWith(20, now);
    expect(repairMissingPaidNotifications.mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(repo.claimNext).mock.invocationCallOrder[0]);
  });

  it("sends the payer a fixed-amount confirmation with the customer signature", async () => {
    const repo = repository();
    const send = vi.fn().mockResolvedValue({ providerMessageId: "email-customer-1" });
    const provider: CustomerEmailProvider = { configured: true, send };
    const service = createPaymentRequestNotificationService(repo, {
      provider,
      siteUrl: "https://shop.example.test",
      now: () => now,
    });

    await expect(service.deliverPending()).resolves.toEqual({
      result: "processed",
      sent: 1,
      failed: 0,
    });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: "aroha@example.test",
      idempotencyKey: customerDelivery.eventKey,
      subject: "Payment confirmed — PAY-2026-ABC123",
      text: expect.stringContaining("NZ$5.00"),
    }));
    expect(send.mock.calls[0][0].text).toContain("Customer Service Team");
    expect(send.mock.calls[0][0].html).toContain("/media/brand/rr-gallery-email-logo.png");
    expect(repo.markSent).toHaveBeenCalledWith(
      customerDelivery.id,
      "email-customer-1",
      now,
    );
  });

  it("sends administrators a distinct receipt without the customer signature", async () => {
    const adminDelivery = Object.freeze({
      ...customerDelivery,
      eventKey: "admin-payment-request-received:20000000-0000-4000-8000-000000000002:admin-1",
      kind: "admin_payment_request_received" as const,
      recipientName: "R&R Gallery team",
      recipientEmail: "owner@example.test",
    });
    const repo = repository(adminDelivery);
    const send = vi.fn().mockResolvedValue({ providerMessageId: "email-admin-1" });
    const service = createPaymentRequestNotificationService(repo, {
      provider: { configured: true, send },
      siteUrl: "https://shop.example.test",
      now: () => now,
    });

    await service.deliverPending();

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: "owner@example.test",
      idempotencyKey: adminDelivery.eventKey,
      subject: "Payment received — PAY-2026-ABC123",
      text: expect.stringContaining(
        "/admin/payment-requests/20000000-0000-4000-8000-000000000002",
      ),
    }));
    expect(send.mock.calls[0][0].text).not.toContain("Customer Service Team");
    expect(send.mock.calls[0][0].html).not.toContain(
      "/media/brand/rr-gallery-email-logo.png",
    );
  });
});
