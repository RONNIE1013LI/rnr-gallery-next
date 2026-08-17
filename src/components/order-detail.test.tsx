import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PublicOrder } from "@/server/orders/order-query-service";
import { OrderDetail } from "./order-detail";

const order: PublicOrder = {
  orderNumber: "RNR-2026-BUNDLE",
  createdAt: "2026-08-17T00:00:00.000Z",
  paymentStatus: "paid",
  fulfilmentStatus: "new",
  currency: "NZD",
  deliveryMethod: "pickup",
  shipping: {
    provider: null,
    serviceName: "Pickup",
    isTest: false,
    amountExGstCents: 0,
    gstCents: 0,
    amountInclGstCents: 0,
  },
  totals: {
    productSubtotalExGstCents: 31_303,
    productGstCents: 4_696,
    productTotalInclGstCents: 35_999,
    totalExGstCents: 31_303,
    totalGstCents: 4_696,
    totalInclGstCents: 35_999,
  },
  items: [{
    productTitle: "Banner Bundle",
    sizeLabel: "85 × 200 cm Roll-Up + 200 × 100 cm Wall Banner",
    peoplePets: 0,
    photoSubmissionMethod: "upload",
    designText: "",
    notes: "",
    neededDate: "2026-08-28",
    urgentServiceConfirmed: false,
    urgentWorkingDays: 9,
    quantity: 1,
    priceLines: [{
      key: "product-size",
      label: "Product / size price",
      amountExGstCents: 31_303,
      amountInclGstCents: 35_999,
    }],
    unitSubtotalExGstCents: 31_303,
    unitGstCents: 4_696,
    unitTotalInclGstCents: 35_999,
    lineSubtotalExGstCents: 31_303,
    lineGstCents: 4_696,
    lineTotalInclGstCents: 35_999,
    bundleComponents: [
      {
        componentKey: "roll-up",
        photoSubmissionMethod: "upload",
        designText: "Roll-up wording",
        notes: "Keep logo clear",
        photoCount: 2,
        backgroundRemovalCount: 1,
      },
      {
        componentKey: "wall-banner",
        photoSubmissionMethod: "later",
        designText: "Wall wording",
        notes: "Wide layout",
        photoCount: 0,
        backgroundRemovalCount: 0,
      },
    ],
  }],
  addresses: {
    billing: {
      country: "NZ",
      fullName: "Aroha Ngata",
      building: "",
      street: "12 Queen Street",
      suburb: "Auckland Central",
      region: "Auckland",
      postcode: "1010",
      phone: "+64211234567",
      email: "aroha@example.test",
    },
    delivery: {
      country: "NZ",
      fullName: "Aroha Ngata",
      building: "",
      street: "12 Queen Street",
      suburb: "Auckland Central",
      region: "Auckland",
      postcode: "1010",
      phone: "+64211234567",
      email: "aroha@example.test",
    },
  },
  payment: null,
};

describe("customer order detail", () => {
  it("shows both privacy-safe Banner Bundle groups", () => {
    const { container } = render(<OrderDetail order={order} />);

    const rollUp = screen.getByRole("region", {
      name: "Roll-Up Banner customisation",
    });
    expect(within(rollUp).getByText("Upload Photos Now")).toBeInTheDocument();
    expect(within(rollUp).getByText("2 photos")).toBeInTheDocument();
    expect(within(rollUp).getByText("Roll-up wording")).toBeInTheDocument();
    expect(within(rollUp).getByText("Keep logo clear")).toBeInTheDocument();

    const wallBanner = screen.getByRole("region", {
      name: "Wall Banner customisation",
    });
    expect(within(wallBanner).getByText("Send Photos After Ordering")).toBeInTheDocument();
    expect(within(wallBanner).getByText("0 photos")).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/uploadReferences|mainPhotoUploadId|upload-private/);
  });
});
