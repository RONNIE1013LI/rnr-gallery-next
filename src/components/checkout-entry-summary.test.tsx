import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { calculateFixedPackage } from "@/domain/pricing/calculate-fixed-package";
import { CheckoutEntrySummary } from "./checkout-entry-summary";

describe("CheckoutEntrySummary", () => {
  beforeEach(() => localStorage.clear());

  it("shows the customer subtotal as GST-inclusive", async () => {
    localStorage.setItem("rnr:commerce:v1:guest:cart", JSON.stringify({
      version: 1,
      items: [{
        id: "item-1",
        productKey: "photo-print-canvas",
        productSlug: "photo-print-canvas",
        productTitle: "Photo Print Canvas",
        imageSrc: "/media/home/family-canvas.webp",
        sizeKey: "a4",
        sizeLabel: "A4 — 29.7 × 21 cm",
        orientation: "landscape",
        peoplePets: 0,
        photoSubmissionMethod: "later",
        designText: "",
        notes: "",
        neededDate: "2026-08-20",
        deliveryPreference: "post",
        quantity: 1,
        price: calculateFixedPackage({ priceExGstCents: 6_500 }),
        uploadReferences: [],
      }],
    }));

    render(<CheckoutEntrySummary />);

    expect(await screen.findByText("Subtotal incl GST")).toBeInTheDocument();
    expect(screen.getByText("Includes GST (15%)")).toBeInTheDocument();
    expect(screen.getAllByText("NZ$74.75")).toHaveLength(2);
    expect(screen.queryByText(/excl GST/i)).not.toBeInTheDocument();
  });
});
