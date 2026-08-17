import { render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { AdminOrderDetail } from "./order-detail";

vi.mock("./order-actions", () => ({ AdminOrderActions: () => null }));

type Detail = ComponentProps<typeof AdminOrderDetail>["detail"];

describe("admin order detail", () => {
  it("groups only authorised upload records under each Bundle component", () => {
    const detail = {
      order: {
        id: "order-1",
        currency: "NZD",
        paymentStatus: "paid",
        fulfilmentStatus: "new",
        deliveryMethod: "pickup",
        shippingServiceName: "Pickup",
        shippingProvider: null,
        shippingTotalInclGstCents: 0,
        trackingNumber: null,
        trackingCarrier: null,
        trackingUrl: null,
        productSubtotalExGstCents: 31_303,
        productGstCents: 4_696,
        shippingExGstCents: 0,
        shippingGstCents: 0,
        totalExGstCents: 31_303,
        totalGstCents: 4_696,
        totalInclGstCents: 35_999,
      },
      items: [{
        id: "item-1",
        productKey: "banner-bundle",
        productTitle: "Banner Bundle",
        sizeLabel: "Roll-Up + Wall Banner",
        orientation: null,
        quantity: 1,
        peoplePets: 0,
        photoSubmissionMethod: "upload",
        neededDate: "2026-08-28",
        urgentServiceConfirmed: false,
        urgentWorkingDays: 9,
        designText: "",
        notes: "",
        priceLines: [{ key: "product-size", label: "Product / size price", amountExGstCents: 31_303 }],
        lineGstCents: 4_696,
        lineTotalInclGstCents: 35_999,
        bundleComponents: [
          {
            componentKey: "roll-up",
            photoSubmissionMethod: "upload",
            designText: "Roll-up wording",
            notes: "Keep logo clear",
            uploadReferences: ["upload-roll-up", "unresolved-private-id"],
            mainPhotoUploadId: "upload-roll-up",
          },
          {
            componentKey: "wall-banner",
            photoSubmissionMethod: "upload",
            designText: "Wall wording",
            notes: "Wide layout",
            uploadReferences: ["upload-wall"],
            mainPhotoUploadId: "upload-wall",
          },
        ],
      }],
      addresses: [],
      payments: [],
      uploads: [
        {
          id: "upload-roll-up",
          orderItemId: "item-1",
          originalName: "roll-up.jpg",
          mediaType: "image/jpeg",
          sizeBytes: 1_000_000,
          purgedAt: null,
        },
        {
          id: "upload-wall",
          orderItemId: "item-1",
          originalName: "wall.jpg",
          mediaType: "image/jpeg",
          sizeBytes: 2_000_000,
          purgedAt: null,
        },
      ],
      notes: [],
      history: [],
    } as unknown as Detail;

    const { container } = render(<AdminOrderDetail detail={detail} />);

    const rollUp = screen.getByRole("region", {
      name: "Roll-Up Banner customisation",
    });
    expect(within(rollUp).getByText("Roll-up wording")).toBeInTheDocument();
    expect(within(rollUp).getByRole("link", { name: "View" })).toHaveAttribute(
      "href",
      "/api/admin/uploads/upload-roll-up",
    );
    expect(within(rollUp).queryByText("wall.jpg")).not.toBeInTheDocument();

    const wallBanner = screen.getByRole("region", {
      name: "Wall Banner customisation",
    });
    expect(within(wallBanner).getByText("wall.jpg")).toBeInTheDocument();
    expect(within(wallBanner).queryByText("roll-up.jpg")).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain("unresolved-private-id");
  });
});
