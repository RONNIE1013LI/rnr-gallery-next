import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AdminOrderDetailPage, { canLoadPaymentSummary } from "./page";

const { requireAdminPage, detail, orderSummary } = vi.hoisted(() => ({
  requireAdminPage: vi.fn(),
  detail: vi.fn(),
  orderSummary: vi.fn(),
}));

vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/server/admin/admin-order-runtime", () => ({
  getAdminOrderRuntime: () => ({ detail }),
}));
vi.mock("@/server/payment-requests/payment-request-runtime", () => ({
  getPaymentRequestRuntime: () => ({ orderSummary }),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => { throw new Error("not found"); }),
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("admin order detail page", () => {
  it("does not expose payment controls for terminal orders", () => {
    expect(canLoadPaymentSummary("cancelled")).toBe(false);
    expect(canLoadPaymentSummary("refunded")).toBe(false);
    expect(canLoadPaymentSummary("paid")).toBe(true);
  });

  it("shows immutable order facts, customer data, payments, notes, and operations", async () => {
    requireAdminPage.mockResolvedValue({
      user: { id: "admin-1", email: "owner@example.test" },
      adminRole: "admin",
    });
    detail.mockResolvedValue({
      order: {
        id: "63f77c27-fd7b-4c65-a834-886c128b6cc1",
        orderNumber: "RNR-2026-ABC123",
        customerEmail: "customer@example.test",
        currency: "NZD",
        deliveryMethod: "post",
        shippingServiceName: "NZ Post Economy",
        shippingProvider: "gosweetspot",
        shippingIsTest: false,
        productSubtotalExGstCents: 30000,
        productGstCents: 4500,
        shippingExGstCents: 1000,
        shippingGstCents: 150,
        shippingTotalInclGstCents: 1150,
        totalExGstCents: 31000,
        totalGstCents: 4650,
        totalInclGstCents: 35650,
        paymentStatus: "paid",
        fulfilmentStatus: "designing",
        trackingNumber: null,
        trackingCarrier: null,
        trackingUrl: null,
        createdAt: new Date("2026-08-04T02:00:00.000Z"),
        updatedAt: new Date("2026-08-04T03:00:00.000Z"),
      },
      addresses: [{
        kind: "delivery",
        fullName: "Example Customer",
        building: "",
        street: "1 Example Street",
        suburb: "Auckland Central",
        region: "Auckland",
        postcode: "1010",
        country: "NZ",
        phone: "+64 21 000 0000",
        email: "customer@example.test",
      }],
      items: [{
        id: "item-1",
        productKey: "digital-oil-painting-canvas",
        productTitle: "Digital Oil Painting Canvas",
        sizeLabel: "A0 — 118.9 × 84.1 cm",
        orientation: "landscape",
        peoplePets: 2,
        photoSubmissionMethod: "upload",
        designText: "Family portrait",
        notes: "Warm background",
        neededDate: "2026-08-12",
        urgentServiceConfirmed: true,
        urgentWorkingDays: 3,
        quantity: 1,
        priceLines: [{ key: "product-size", label: "Product / size price", amountExGstCents: 28000 }],
        lineSubtotalExGstCents: 30000,
        lineGstCents: 4500,
        lineTotalInclGstCents: 34500,
      }],
      payments: [{
        id: "payment-1",
        provider: "stripe",
        method: "card",
        status: "paid",
        providerReference: "pi_reference",
        expectedAmountCents: 35650,
        createdAt: new Date("2026-08-04T02:05:00.000Z"),
        updatedAt: new Date("2026-08-04T02:06:00.000Z"),
      }],
      uploads: [
        {
          id: "upload-1",
          orderItemId: "item-1",
          originalName: "family-photo.jpg",
          mediaType: "image/jpeg",
          sizeBytes: 123456,
          purgedAt: null,
        },
        {
          id: "upload-purged",
          orderItemId: "item-1",
          originalName: null,
          mediaType: null,
          sizeBytes: null,
          purgedAt: new Date("2026-08-17T00:00:00Z"),
        },
      ],
      notes: [{ id: "note-1", visibility: "internal", body: "Check image quality", authorEmail: "owner@example.test", createdAt: new Date("2026-08-04T03:00:00.000Z") }],
      history: [{ id: "history-1", fromStatus: "new", toStatus: "designing", actorEmail: "owner@example.test", reason: "Assigned", createdAt: new Date("2026-08-04T03:00:00.000Z") }],
    });
    orderSummary.mockResolvedValue({
      orderId: "63f77c27-fd7b-4c65-a834-886c128b6cc1",
      orderNumber: "RNR-2026-ABC123",
      currency: "NZD",
      totalCents: 35650,
      netPaidCents: 10000,
      outstandingCents: 25650,
      reservedCents: 0,
      unreservedCents: 25650,
      ledger: [],
    });

    render(await AdminOrderDetailPage({ params: Promise.resolve({
      orderId: "63f77c27-fd7b-4c65-a834-886c128b6cc1",
    }) }));

    expect(screen.getByRole("heading", { name: "RNR-2026-ABC123" })).toBeInTheDocument();
    expect(screen.getByText(/A0 — 118\.9 × 84\.1 cm/)).toBeInTheDocument();
    expect(screen.getByText("family-photo.jpg")).toBeInTheDocument();
    const tombstone = screen.getByText(
      "Original photo deleted after the 5-day storage period.",
    ).closest("li");
    expect(tombstone).not.toBeNull();
    expect(within(tombstone!).queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Check image quality")).toBeInTheDocument();
    expect(screen.getByText("NZ Post Economy")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Update order status" })).toBeInTheDocument();
    expect(screen.getByText("Original price snapshot — read only")).toBeInTheDocument();
    expect(screen.getByText(/Payment status is controlled by payment events/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Order payment balance" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create payment request" })).toHaveAttribute(
      "href", "/admin/payment-requests/new?orderId=63f77c27-fd7b-4c65-a834-886c128b6cc1",
    );
  });

  it("shows a legacy Grave Cover order as 100 × 200 cm without orientation", async () => {
    requireAdminPage.mockResolvedValue({
      user: { id: "admin-1", email: "owner@example.test" },
      adminRole: "admin",
    });
    detail.mockResolvedValue({
      order: {
        id: "63f77c27-fd7b-4c65-a834-886c128b6cc1",
        orderNumber: "RNR-2026-GRAVE",
        customerEmail: "customer@example.test",
        currency: "NZD",
        deliveryMethod: "pickup",
        shippingServiceName: "Pickup",
        shippingProvider: null,
        shippingIsTest: false,
        productSubtotalExGstCents: 18500,
        productGstCents: 2775,
        shippingExGstCents: 0,
        shippingGstCents: 0,
        shippingTotalInclGstCents: 0,
        totalExGstCents: 18500,
        totalGstCents: 2775,
        totalInclGstCents: 21275,
        paymentStatus: "paid",
        fulfilmentStatus: "new",
        trackingNumber: null,
        trackingCarrier: null,
        trackingUrl: null,
        createdAt: new Date("2026-08-04T02:00:00.000Z"),
        updatedAt: new Date("2026-08-04T03:00:00.000Z"),
      },
      addresses: [],
      items: [{
        id: "item-grave",
        productKey: "grave-cover",
        productTitle: "Grave Cover",
        sizeLabel: "200 × 100 cm",
        orientation: "portrait",
        peoplePets: 0,
        photoSubmissionMethod: "later",
        designText: "",
        notes: "",
        neededDate: "2026-08-12",
        urgentServiceConfirmed: false,
        urgentWorkingDays: 5,
        quantity: 1,
        priceLines: [{ key: "product-size", label: "Product / size price", amountExGstCents: 18500 }],
        lineSubtotalExGstCents: 18500,
        lineGstCents: 2775,
        lineTotalInclGstCents: 21275,
      }],
      payments: [],
      uploads: [],
      notes: [],
      history: [],
    });
    orderSummary.mockResolvedValue({
      orderId: "63f77c27-fd7b-4c65-a834-886c128b6cc1",
      orderNumber: "RNR-2026-GRAVE",
      currency: "NZD",
      totalCents: 21275,
      netPaidCents: 21275,
      outstandingCents: 0,
      reservedCents: 0,
      unreservedCents: 0,
      ledger: [],
    });

    render(await AdminOrderDetailPage({ params: Promise.resolve({
      orderId: "63f77c27-fd7b-4c65-a834-886c128b6cc1",
    }) }));

    expect(screen.getByText("100 × 200 cm")).toBeInTheDocument();
    expect(screen.queryByText(/Portrait/)).not.toBeInTheDocument();
  });
});
