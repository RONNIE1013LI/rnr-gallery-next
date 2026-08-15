import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RepricedCheckoutCart } from "@/domain/checkout/types";
import { CheckoutOrderSummary } from "./checkout-order-summary";

describe("CheckoutOrderSummary", () => {
  it("shows the trusted gallery snapshot without affecting totals", () => {
    const designId = "a".repeat(64);
    const cart = {
      version: 1,
      market: "NZ", currency: "NZD", taxJurisdiction: "NZ_GST",
      taxRateBasisPoints: 1_500, priceBookRevision: 0,
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
        quantity: 1, uploadReferences: [], unitPrice: {
          market: "NZ", currency: "NZD", taxJurisdiction: "NZ_GST",
          taxRateBasisPoints: 1_500, discountCents: 0, designSurchargeCents: 0,
          lines: [], subtotalExGstCents: 6500, gstCents: 975, totalInclGstCents: 7475,
        },
        lineSubtotalExGstCents: 6500, lineGstCents: 975, lineTotalInclGstCents: 7475,
      }],
      subtotalExGstCents: 6500, gstCents: 975, totalInclGstCents: 7475,
      discountCents: 0, designSurchargeCents: 0, itemCount: 1,
      cartDigest: "c".repeat(64),
    } as const satisfies RepricedCheckoutCart;

    render(<CheckoutOrderSummary cart={cart} shipping={null} />);
    expect(screen.getByText("Family at sunset")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Family at sunset" })).toBeInTheDocument();
    expect(screen.getByText("Products incl GST")).toBeInTheDocument();
    expect(screen.getByText("Shipping incl GST")).toBeInTheDocument();
    expect(screen.getByText("Includes GST")).toBeInTheDocument();
    expect(screen.getAllByText("NZ$74.75")).toHaveLength(2);
    expect(screen.queryByText(/excl GST/i)).not.toBeInTheDocument();
  });

  it("uses one concise test-rate disclosure", () => {
    const cart = {
      version: 1,
      market: "NZ", currency: "NZD", taxJurisdiction: "NZ_GST",
      taxRateBasisPoints: 1_500, priceBookRevision: 0,
      orderDate: "2026-08-03",
      items: [],
      subtotalExGstCents: 0,
      gstCents: 0,
      totalInclGstCents: 0,
      discountCents: 0,
      designSurchargeCents: 0,
      itemCount: 0,
      cartDigest: "c".repeat(64),
    } as const satisfies RepricedCheckoutCart;

    render(<CheckoutOrderSummary cart={cart} shipping={{
      method: "post", serviceCode: "test-post", serviceName: "Test Post — not a live carrier rate",
      amountExGstCents: 2000, gstCents: 300, amountInclGstCents: 2300, currency: "NZD",
      provenance: "local-test", isTest: true,
    }} />);

    expect(screen.getByText("Test Post · Test rate — not a live carrier rate")).toBeInTheDocument();
    expect(screen.getAllByText("NZ$23.00")).toHaveLength(2);
    expect(screen.queryByText("Test Post — not a live carrier rate · Test rate — not a live carrier rate")).not.toBeInTheDocument();
  });

  it("corrects the known GoSweetSpot Auckland label typo", () => {
    const cart = {
      version: 1,
      market: "NZ", currency: "NZD", taxJurisdiction: "NZ_GST",
      taxRateBasisPoints: 1_500, priceBookRevision: 0,
      orderDate: "2026-08-03",
      items: [],
      subtotalExGstCents: 0,
      gstCents: 0,
      totalInclGstCents: 0,
      discountCents: 0,
      designSurchargeCents: 0,
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

  it("renders Australian products, fixed shipping and totals only in AUD", () => {
    const cart = {
      version: 1, market: "AU", currency: "AUD", taxJurisdiction: "NONE",
      taxRateBasisPoints: 1_000, priceBookRevision: 9, orderDate: "2026-08-03",
      items: [], subtotalExGstCents: 40_000, gstCents: 0, totalInclGstCents: 40_000,
      discountCents: 0, designSurchargeCents: 0, itemCount: 1,
      cartDigest: "d".repeat(64),
    } as const satisfies RepricedCheckoutCart;
    render(<CheckoutOrderSummary cart={cart} shipping={{
      method: "post", serviceCode: "au-standard", serviceName: "Australia standard delivery",
      amountExGstCents: 4_500, gstCents: 0, amountInclGstCents: 4_500, currency: "AUD",
      provenance: "internal-fixed", isTest: false,
    }} />);

    expect(screen.getByText("Products")).toBeVisible();
    expect(screen.getByText("GST not charged")).toBeVisible();
    expect(screen.getByText("A$400.00 AUD")).toBeVisible();
    expect(screen.getAllByText("A$445.00 AUD")).toHaveLength(1);
    expect(screen.getByText("Australia standard delivery · Fixed Australian delivery")).toBeVisible();
    expect(screen.queryByText(/NZ\$/)).not.toBeInTheDocument();
  });
});
