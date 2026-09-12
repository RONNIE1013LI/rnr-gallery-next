import { describe, expect, it, vi } from "vitest";
import { createInvoiceEmailService, type InvoiceLike } from "./invoice-email-service";

const invoice = {
  id: "11111111-1111-4111-8111-111111111111", jobId: "job", invoiceNumber: "INV-1", status: "issued", invoiceDate: "2026-09-12", dueDate: "2026-09-19", webOrderNumber: "RNR-1", customerName: "Aroha", customerEmail: "aroha@example.test", businessName: "R&R Gallery", currency: "NZD", totalInclGstCents: 12000, amountPaidCents: 2000,
} as InvoiceLike;

describe("invoice email service", () => {
  it("renders, signs, attaches the current PDF, and records a successful attempt", async () => {
    const provider = { configured: true, send: vi.fn().mockResolvedValue({ providerMessageId: "email-1" }) };
    const audit = vi.fn();
    const service = createInvoiceEmailService({ provider, createPdf: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])), recordAttempt: audit, siteUrl: "https://rnrgallery.com", orderAccessSecret: "x".repeat(32), loadPublishedTemplates: async () => ({}), loadPublishedSignature: async () => ({}), now: () => new Date("2026-09-12T00:00:00Z") });
    const result = await service.send(invoice, { recipientEmail: "aroha@example.test", subject: undefined, body: undefined, idempotencyKey: "invoice-send-1" });
    expect(result).toEqual({ result: "sent", providerMessageId: "email-1" });
    expect(provider.send).toHaveBeenCalledWith(expect.objectContaining({ to: "aroha@example.test", attachments: [{ filename: "INV-1.pdf", content: "AQID" }] }));
    expect(provider.send.mock.calls[0][0].html).toContain("Kind regards");
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ result: "success", providerMessageId: "email-1" }));
  });
});
