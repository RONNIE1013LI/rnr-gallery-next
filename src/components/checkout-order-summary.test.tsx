import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RepricedCheckoutCart } from "@/domain/checkout/types";
import { CheckoutOrderSummary } from "./checkout-order-summary";

describe("CheckoutOrderSummary", () => {
  it("shows the trusted gallery snapshot without affecting totals", () => {
    const designId = "a".repeat(64);
    const cart = {
      version: 1,
      orderDate: "2026-08-03",
      items: [{
        clientItemId: "30000000-0000-4000-8000-000000000001",
        productKey: "photo-print-canvas",
        productSlug: "photo-print-canvas",
        productTitle: "Photo Print Canvas",
        galleryDesign: { id: designId, title: "Family at sunset", contentHash: "b".repeat(64), productSlug: "photo-print-canvas", imageUrl: `/gallery-images/${designId}?v=${"b".repeat(64)}` },
        sizeKey: "a4", sizeLabel: "A4", orientation: "landscape", peoplePets: 0,
        photoSubmissionMethod: "later", designText: "", notes: "", neededDate: "2026-08-10",
        urgentServiceConfirmed: false, urgentService: { workingDays: 5, feeInclGstCents: 0 },
        quantity: 1, uploadReferences: [], unitPrice: { lines: [], subtotalExGstCents: 6500, gstCents: 975, totalInclGstCents: 7475 },
        lineSubtotalExGstCents: 6500, lineGstCents: 975, lineTotalInclGstCents: 7475,
      }],
      subtotalExGstCents: 6500, gstCents: 975, totalInclGstCents: 7475, itemCount: 1,
      cartDigest: "c".repeat(64),
    } as const satisfies RepricedCheckoutCart;

    render(<CheckoutOrderSummary cart={cart} shipping={null} />);
    expect(screen.getByText("Family at sunset")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Family at sunset" })).toBeInTheDocument();
    expect(screen.getByText("$74.75")).toBeInTheDocument();
  });

  it("uses one concise test-rate disclosure", () => {
    const cart = {
      version: 1,
      orderDate: "2026-08-03",
      items: [],
      subtotalExGstCents: 0,
      gstCents: 0,
      totalInclGstCents: 0,
      itemCount: 0,
      cartDigest: "c".repeat(64),
    } as const satisfies RepricedCheckoutCart;

    render(<CheckoutOrderSummary cart={cart} shipping={{
      method: "post", serviceCode: "test-post", serviceName: "Test Post — not a live carrier rate",
      amountExGstCents: 2000, gstCents: 300, amountInclGstCents: 2300, currency: "NZD",
      provenance: "local-test", isTest: true,
    }} />);

    expect(screen.getByText("Test Post · Test rate — not a live carrier rate")).toBeInTheDocument();
    expect(screen.queryByText("Test Post — not a live carrier rate · Test rate — not a live carrier rate")).not.toBeInTheDocument();
  });

  it("corrects the known GoSweetSpot Auckland label typo", () => {
    const cart = {
      version: 1,
      orderDate: "2026-08-03",
      items: [],
      subtotalExGstCents: 0,
      gstCents: 0,
      totalInclGstCents: 0,
      itemCount: 0,
      cartDigest: "c".repeat(64),
    } as const satisfies RepricedCheckoutCart;

    render(<CheckoutOrderSummary cart={cart} shipping={{
      method: "post", serviceCode: "akl", serviceName: "Auckalnd Urban",
      amountExGstCents: 1000, gstCents: 150, amountInclGstCents: 1150, currency: "NZD",
      provenance: "gosweetspot", isTest: false,
    }} />);

    expect(screen.getByText("Auckland Urban · Live carrier rate")).toBeInTheDocument();
    expect(screen.queryByText(/Auckalnd/)).not.toBeInTheDocument();
  });
});
