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

  it("hides the zero GST row for an Australian cart", async () => {
    localStorage.setItem("rnr:commerce:v1:guest:cart", JSON.stringify({
      version: 1,
      items: [{
        id: "item-au",
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
        price: {
          market: "AU",
          currency: "AUD",
          taxJurisdiction: "NONE",
          taxRateBasisPoints: 1_000,
          discountCents: 0,
          designSurchargeCents: 0,
          lines: [],
          subtotalExGstCents: 8_000,
          gstCents: 0,
          totalInclGstCents: 8_000,
        },
        uploadReferences: [],
      }],
    }));

    render(<CheckoutEntrySummary />);

    expect(await screen.findByText("Subtotal")).toBeInTheDocument();
    expect(screen.queryByText("GST not charged")).not.toBeInTheDocument();
    expect(screen.queryByText("A$0.00 AUD")).not.toBeInTheDocument();
    expect(screen.getAllByText("A$80.00 AUD")).toHaveLength(2);
  });

  it("shows privacy-safe Banner Bundle component methods and photo counts", async () => {
    localStorage.setItem("rnr:commerce:v1:guest:cart", JSON.stringify({
      version: 1,
      items: [{
        id: "bundle-item", productKey: "banner-bundle", productSlug: "banner-bundle",
        productTitle: "Banner Bundle", imageSrc: "/media/products/banner-bundle.png",
        sizeKey: "rollup-wall-200x100", sizeLabel: "Roll-Up + Wall Banner",
        peoplePets: 0, photoSubmissionMethod: "upload",
        designText: "Customer secret combined wording", notes: "Customer secret notes",
        neededDate: "2026-08-20", deliveryPreference: "post", quantity: 1,
        price: calculateFixedPackage({ priceExGstCents: 29_999 }),
        uploadReferences: ["blob:family-secret.jpg", "blob:second-secret.jpg"],
        bundleComponents: [
          {
            componentKey: "roll-up", photoSubmissionMethod: "upload",
            designText: "Customer secret Roll-Up wording", notes: "Customer secret notes",
            uploadReferences: ["blob:family-secret.jpg", "blob:second-secret.jpg"],
            mainPhotoUploadId: "blob:family-secret.jpg",
            extraBackgroundRemovalUploadIds: ["blob:second-secret.jpg"],
          },
          {
            componentKey: "wall-banner", photoSubmissionMethod: "later",
            designText: "Customer secret Wall wording", notes: "Customer secret notes",
            uploadReferences: [],
          },
        ],
      }],
    }));

    render(<CheckoutEntrySummary />);

    const rollUp = await screen.findByLabelText("Roll-Up Banner customisation summary");
    expect(rollUp).toHaveTextContent("Upload Now");
    expect(rollUp).toHaveTextContent("2 photos");
    expect(rollUp).toHaveTextContent("Additional background removal: Yes");
    const wallBanner = screen.getByLabelText("Wall Banner customisation summary");
    expect(wallBanner).toHaveTextContent("Send Later");
    expect(wallBanner).toHaveTextContent("0 photos");
    expect(wallBanner).toHaveTextContent("Additional background removal: No");
    expect(screen.queryByText(/family-secret\.jpg|blob:|Customer secret/)).not.toBeInTheDocument();
  });
});
