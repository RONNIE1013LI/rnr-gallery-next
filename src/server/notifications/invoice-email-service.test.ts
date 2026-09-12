import { describe, expect, it, vi } from "vitest";
import { createInvoiceEmailService, type InvoiceLike } from "./invoice-email-service";

const invoice = {
  id: "11111111-1111-4111-8111-111111111111", jobId: "job", invoiceNumber: "INV-1", status: "issued", invoiceDate: "2026-09-12", dueDate: "2026-09-19", webOrderNumber: "RNR-1", customerName: "Aroha", customerEmail: "aroha@example.test", businessName: "R&R Gallery", currency: "NZD", totalInclGstCents: 12000, amountPaidCents: 2000,
} as InvoiceLike;

describe("invoice email service", () => {
  it("renders, signs, attaches the current PDF, and records a successful attempt", async () => {
    const provider = { configured: true, send: vi.fn().mockResolvedValue({ providerMessageId: "email-1" }) };
    const audit = vi.fn();
    const service = createInvoiceEmailService({ provider, createPdf: vi.fn().mockResolvedValue(Buffer.from("%PDF-1.7 test")), recordAttempt: audit, siteUrl: "https://rnrgallery.com", orderAccessSecret: "x".repeat(32), loadPublishedTemplates: async () => ({}), loadPublishedSignature: async () => ({}), now: () => new Date("2026-09-12T00:00:00Z") });
    const result = await service.send(invoice, { recipientEmail: "aroha@example.test", subject: undefined, body: undefined, idempotencyKey: "invoice-send-1" });
    expect(result).toEqual({ result: "sent", providerMessageId: "email-1" });
    expect(provider.send).toHaveBeenCalledWith(expect.objectContaining({ to: "aroha@example.test", attachments: [{ filename: "INV-1.pdf", content: Buffer.from("%PDF-1.7 test").toString("base64") }] }));
    expect(provider.send.mock.calls[0][0].html).toContain("Kind regards");
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ result: "success", providerMessageId: "email-1" }));
  });
});


describe("invoice email failure isolation and optional customer link", () => {
  function setup() {
    const provider = { configured: true, send: vi.fn().mockResolvedValue({ providerMessageId: "mail" }) };
    const recordAttempt = vi.fn();
    const createPdf = vi.fn().mockResolvedValue(Buffer.from("%PDF-1.7 test"));
    const service = createInvoiceEmailService({ provider, recordAttempt, createPdf, siteUrl: "https://rrgallery.co.nz", orderAccessSecret: "x".repeat(32) });
    return { service, provider, recordAttempt, createPdf };
  }
  it("omits the customer link for a manual invoice without a web order", async () => {
    const { service, provider } = setup();
    await service.send({ ...invoice, webOrderNumber: "" }, { idempotencyKey: "manual-no-link" });
    const message = provider.send.mock.calls[0][0];
    expect(message.text).not.toContain("/orders/");
    expect(message.text).not.toContain("view your order here");
    expect(message.html.match(/Kind regards/g)).toHaveLength(1);
  });
  it("records PDF failure without sending", async () => {
    const { service, provider, recordAttempt, createPdf } = setup();
    createPdf.mockRejectedValue(new Error("pdf failed"));
    await expect(service.send(invoice, { idempotencyKey: "pdf-failure" })).resolves.toMatchObject({ result: "failed" });
    expect(provider.send).not.toHaveBeenCalled();
    expect(recordAttempt).toHaveBeenCalledWith(expect.objectContaining({ result: "failure", errorCode: "pdf_error" }));
  });
  it.each(["template", "empty_pdf", "provider"])("records %s failure before reporting success", async (failure) => {
    const { provider, recordAttempt, createPdf } = setup();
    const loadPublishedTemplates = vi.fn().mockResolvedValue({ "email.invoice_sent.subject": "Saved {{invoice_number}}", "email.invoice_sent.body": "Hello {{customer_name}}. Total {{total}}" });
    if (failure === "template") loadPublishedTemplates.mockRejectedValue(new Error("template unavailable"));
    if (failure === "empty_pdf") createPdf.mockResolvedValue(new Uint8Array());
    if (failure === "provider") provider.send.mockRejectedValue(new Error("timeout"));
    const service = createInvoiceEmailService({ provider, recordAttempt, createPdf, loadPublishedTemplates, siteUrl: "https://rrgallery.co.nz", orderAccessSecret: "x".repeat(32) });
    await expect(service.send(invoice, { idempotencyKey: `failure-${failure}` })).resolves.toMatchObject({ result: "failed" });
    expect(recordAttempt).toHaveBeenCalledWith(expect.objectContaining({ result: "failure" }));
    expect(provider.send).toHaveBeenCalledTimes(failure === "provider" ? 1 : 0);
  });
  it("uses the saved template and signature without mutating them", async () => {
    const { provider, recordAttempt, createPdf } = setup();
    const templates = Object.freeze({ "email.invoice_sent.subject": "Saved {{invoice_number}}", "email.invoice_sent.body": "Hello {{customer_name}}. Total {{total}}" });
    const signature = Object.freeze({ "email.signature.signoff": "With thanks" });
    const service = createInvoiceEmailService({ provider, recordAttempt, createPdf, loadPublishedTemplates: async () => templates, loadPublishedSignature: async () => signature, siteUrl: "https://rrgallery.co.nz", orderAccessSecret: "x".repeat(32) });
    await service.send(invoice, { idempotencyKey: "saved-template-test" });
    expect(provider.send.mock.calls[0][0]).toMatchObject({ subject: "Saved INV-1" });
    expect(provider.send.mock.calls[0][0].text).toContain("Total NZ$120.00");
    expect(provider.send.mock.calls[0][0].text.match(/With thanks/g)).toHaveLength(1);
    expect(templates["email.invoice_sent.subject"]).toBe("Saved {{invoice_number}}");
  });

});
