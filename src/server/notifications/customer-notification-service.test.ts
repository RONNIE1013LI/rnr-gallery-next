import { describe, expect, it, vi } from "vitest";
import { verifyProofAccess } from "@/server/production/proof-access-link";
import {
  EmailDeliveryError,
  createCustomerNotificationService,
  type CustomerNotificationRepository,
} from "./customer-notification-service";

const secret = "notification-proof-secret-with-more-than-thirty-two-characters";
const event = Object.freeze({
  id: "10000000-0000-4000-8000-000000000001",
  eventKey: "proof-ready:20000000-0000-4000-8000-000000000002",
  kind: "proof_ready" as const,
  jobId: "30000000-0000-4000-8000-000000000003",
  orderId: "40000000-0000-4000-8000-000000000004",
  orderNumber: "RNR-2026-ABC123",
  fileId: "20000000-0000-4000-8000-000000000002",
  proofVersion: 2,
  customerName: "Aroha Ngata",
  recipientEmail: "aroha@example.test",
  status: "sending" as const,
  attempts: 1,
  createdAt: new Date("2026-08-05T00:00:00.000Z"),
});

function repository(overrides: Partial<CustomerNotificationRepository> = {}): CustomerNotificationRepository {
  return {
    claimForFile: vi.fn().mockResolvedValue(event),
    claimNext: vi.fn().mockResolvedValue(event),
    markSent: vi.fn().mockResolvedValue(true),
    markFailed: vi.fn().mockResolvedValue(true),
    listForJob: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("customer proof notification delivery", () => {
  it("leaves the durable event pending when email is not configured", async () => {
    const repo = repository();
    const service = createCustomerNotificationService(repo, {
      provider: { configured: false, send: vi.fn() },
      siteUrl: "https://rnrgallery.example",
      proofSecret: secret,
    });

    await expect(service.deliverForFile(event.fileId)).resolves.toEqual({ result: "not_configured" });
    expect(repo.claimForFile).not.toHaveBeenCalled();
  });

  it("sends one stable signed proof link and records the provider result", async () => {
    const send = vi.fn().mockResolvedValue({ providerMessageId: "email-123" });
    const repo = repository();
    const service = createCustomerNotificationService(repo, {
      provider: { configured: true, send },
      siteUrl: "https://rnrgallery.example/",
      proofSecret: secret,
      loadPublishedSignature: vi.fn().mockResolvedValue({
        "email.signature.team_name": "R&R Customer Care",
      }),
      now: () => new Date("2026-08-05T01:00:00.000Z"),
    });

    await expect(service.deliverForFile(event.fileId)).resolves.toEqual({ result: "sent" });
    const message = send.mock.calls[0][0];
    expect(message).toMatchObject({
      to: event.recipientEmail,
      idempotencyKey: event.eventKey,
      subject: `Your R&R Gallery design draft v${event.proofVersion} is ready`,
    });
    expect(message.text).toContain("R&R Customer Care");
    expect(message.html).toContain(
      "https://rnrgallery.example/media/brand/rr-gallery-logo-2026.webp",
    );
    const link = new URL(message.proofUrl);
    const expires = Number(link.searchParams.get("expires"));
    const signature = link.searchParams.get("signature");
    expect(link.origin).toBe("https://rnrgallery.example");
    expect(link.pathname).toBe(`/orders/${event.orderNumber}/proof`);
    expect(link.searchParams.get("file")).toBe(event.fileId);
    expect(verifyProofAccess({
      orderNumber: event.orderNumber,
      fileId: event.fileId,
      expires,
    }, signature, secret, new Date("2026-08-06T00:00:00.000Z"))).toBe(true);
    expect(repo.markSent).toHaveBeenCalledWith(event.id, "email-123", new Date("2026-08-05T01:00:00.000Z"));
  });

  it("keeps a safe retry record when the provider fails", async () => {
    const repo = repository();
    const service = createCustomerNotificationService(repo, {
      provider: {
        configured: true,
        send: vi.fn().mockRejectedValue(new EmailDeliveryError("rate_limited")),
      },
      siteUrl: "https://rnrgallery.example",
      proofSecret: secret,
      now: () => new Date("2026-08-05T01:00:00.000Z"),
    });

    await expect(service.deliverForFile(event.fileId)).resolves.toEqual({ result: "failed" });
    expect(repo.markFailed).toHaveBeenCalledWith(
      event.id,
      "rate_limited",
      new Date("2026-08-05T01:05:00.000Z"),
      new Date("2026-08-05T01:00:00.000Z"),
    );
  });
});
