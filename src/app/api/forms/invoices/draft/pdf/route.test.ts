import { describe, expect, it, vi } from "vitest";
import { createDraftInvoicePdfRoute } from "./route-handler";

const origin = "https://shop.example.test";
const draft = {
  invoiceDate: "2026-08-16", dueDate: "2026-08-23", reference: "DRAFT",
  businessName: "R&R Gallery", businessAddress: "Auckland", businessEmail: "customerservice@rnrgallery.com", businessPhone: "+642102348948",
  businessWebsite: "https://rnrgallery.com/", gstNumber: "125-796-389", bankAccount: "04-2021-0317735-07",
  customerName: "Customer", customerEmail: "customer@example.com", customerAddress: "Address", deliveryAddress: "Address",
  discountCents: 0, notes: "Thanks", terms: "Seven days", items: [{ code: "PRD", description: "Order item", quantityMilli: 1_000, rateInclGstCents: 23_000 }],
};

describe("draft invoice PDF route", () => {
  it("requires finance permission and renders a transient draft", async () => {
    const requirePermission = vi.fn().mockResolvedValue({ user: { id: "finance-1" } });
    const createPdf = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    const post = createDraftInvoicePdfRoute({ requirePermission, createPdf, trustedOrigin: origin });
    const response = await post(new Request(`${origin}/api/forms/invoices/draft/pdf`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ currency: "NZD", gstRateBasisPoints: 1500, draft }) }));
    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith("update_finance");
    expect(createPdf).toHaveBeenCalledWith(expect.objectContaining({ invoiceNumber: "INV-DRAFT", totalInclGstCents: 23_000 }));
  });

  it("rejects invalid invoice data", async () => {
    const post = createDraftInvoicePdfRoute({ requirePermission: vi.fn().mockResolvedValue({}), createPdf: vi.fn(), trustedOrigin: origin });
    const response = await post(new Request(`${origin}/api/forms/invoices/draft/pdf`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ currency: "NZD", gstRateBasisPoints: 1500, draft: { ...draft, customerName: "" } }) }));
    expect(response.status).toBe(422);
  });
});
