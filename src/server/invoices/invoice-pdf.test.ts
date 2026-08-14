import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { InvoiceRecord } from "./invoice-service";
import { createInvoicePdf } from "./invoice-pdf";

const now = new Date("2026-08-05T01:00:00.000Z");
const invoice: InvoiceRecord = {
  id: "00000000-0000-4000-8000-000000000010",
  jobId: "00000000-0000-4000-8000-000000000001",
  invoiceNumber: "INV-RRM-2026-ABC123",
  status: "issued",
  invoiceDate: "2026-08-05",
  dueDate: "2026-08-12",
  reference: "RRM-2026-ABC123",
  webOrderNumber: "WEB-1042",
  businessName: "R&R Gallery",
  businessAddress: "11 Para Close\nAuckland 0632\nNew Zealand",
  businessEmail: "customerservice@rnrgallery.com",
  businessPhone: "+64 21 023 48948",
  businessWebsite: "https://rnrgallery.com/",
  gstNumber: "125-796-389",
  bankAccount: "04-0000-0000000-00",
  customerName: "Ana <script>alert(1)</script> Example",
  customerEmail: "ana@example.com",
  customerAddress: "11 Example Street\nAuckland 0632",
  deliveryAddress: "11 Example Street\nAuckland 0632",
  currency: "NZD",
  gstRateBasisPoints: 1_500,
  pricesIncludeGst: true,
  grossCents: 23_000,
  discountCents: 0,
  subtotalExGstCents: 20_000,
  gstCents: 3_000,
  totalInclGstCents: 23_000,
  notes: "Thank you for your business!",
  terms: "Payment is due within 7 days.",
  issuedAt: now,
  voidedAt: null,
  voidReason: null,
  createdAt: now,
  updatedAt: now,
  items: [{
    position: 0,
    code: "A4",
    description: "Digital Oil Painting Canvas — A4",
    quantityMilli: 1_000,
    rateInclGstCents: 23_000,
    lineTotalInclGstCents: 23_000,
  }],
};

describe("invoice PDF", () => {
  it("creates a valid server-side A4 tax invoice without executable content", async () => {
    const bytes = await createInvoicePdf(invoice);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(2_000);
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBe(1);
    expect(document.getTitle()).toBe("Tax Invoice INV-RRM-2026-ABC123");
    expect(document.getSubject()).toBe("R&R Gallery tax invoice");
    expect(new TextDecoder().decode(bytes)).not.toContain("/JavaScript");
  });
});
