import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { calculateFixedPackage } from "@/domain/pricing/calculate-fixed-package";
import type { CartItem } from "@/domain/cart/types";
import { CartView } from "./cart-view";

const analytics = vi.hoisted(() => ({
  emitAnalyticsEvent: vi.fn<(event: unknown) => boolean>(() => true),
}));

vi.mock("@/domain/analytics/client", () => analytics);

const cartItem: CartItem = {
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
  designText: "Family name",
  notes: "Warm colours",
  neededDate: "2026-08-20",
  deliveryPreference: "post",
  quantity: 1,
  price: calculateFixedPackage({ priceExGstCents: 6_500 }),
  uploadReferences: [],
};

const bundleItem: CartItem = {
  ...cartItem,
  id: "bundle-item",
  productKey: "banner-bundle",
  productSlug: "banner-bundle",
  productTitle: "Banner Bundle",
  imageSrc: "/media/products/banner-bundle.png",
  sizeKey: "rollup-wall-200x100",
  sizeLabel: "85 × 200 cm Roll-Up + 200 × 100 cm Wall Banner",
  photoSubmissionMethod: "upload",
  designText: "Customer secret combined wording",
  notes: "Customer secret combined notes",
  uploadReferences: ["blob:family-secret.jpg", "blob:second-secret.jpg"],
  bundleComponents: [
    {
      componentKey: "roll-up",
      photoSubmissionMethod: "upload",
      designText: "Customer secret Roll-Up wording",
      notes: "Customer secret Roll-Up notes",
      uploadReferences: ["blob:family-secret.jpg", "blob:second-secret.jpg"],
      mainPhotoUploadId: "blob:family-secret.jpg",
      extraBackgroundRemovalUploadIds: ["blob:second-secret.jpg"],
    },
    {
      componentKey: "wall-banner",
      photoSubmissionMethod: "later",
      designText: "Customer secret Wall wording",
      notes: "Customer secret Wall notes",
      uploadReferences: [],
    },
  ],
};

function seedCart() {
  localStorage.setItem(
    "rnr:commerce:v1:guest:cart",
    JSON.stringify({ version: 1, items: [cartItem] }),
  );
}

function marketPrice(market: "NZ" | "AU") {
  return {
    market,
    currency: market === "AU" ? "AUD" as const : "NZD" as const,
    taxJurisdiction: market === "AU" ? "NONE" as const : "NZ_GST" as const,
    taxRateBasisPoints: market === "AU" ? 1_000 : 1_500,
    discountCents: 0,
    designSurchargeCents: 0,
    lines: [],
    subtotalExGstCents: market === "AU" ? 8_000 : 6_500,
    gstCents: market === "AU" ? 0 : 975,
    totalInclGstCents: market === "AU" ? 8_000 : 7_475,
  };
}

function marketResponse(market: "NZ" | "AU") {
  const unitPrice = marketPrice(market);
  return new Response(JSON.stringify({
    market,
    currency: unitPrice.currency,
    cart: {
      version: 1,
      market,
      currency: unitPrice.currency,
      taxJurisdiction: unitPrice.taxJurisdiction,
      taxRateBasisPoints: unitPrice.taxRateBasisPoints,
      priceBookRevision: 12,
      orderDate: "2026-08-26",
      items: [{
        clientItemId: cartItem.id,
        productKey: cartItem.productKey,
        productSlug: cartItem.productSlug,
        productTitle: cartItem.productTitle,
        sizeKey: cartItem.sizeKey,
        sizeLabel: cartItem.sizeLabel,
        orientation: cartItem.orientation,
        peoplePets: cartItem.peoplePets,
        photoSubmissionMethod: cartItem.photoSubmissionMethod,
        designText: cartItem.designText,
        notes: cartItem.notes,
        neededDate: cartItem.neededDate,
        urgentServiceConfirmed: false,
        urgentService: { workingDays: 5, feeInclGstCents: 0 },
        quantity: cartItem.quantity,
        uploadReferences: cartItem.uploadReferences,
        unitPrice,
        lineSubtotalExGstCents: unitPrice.subtotalExGstCents,
        lineGstCents: unitPrice.gstCents,
        lineTotalInclGstCents: unitPrice.totalInclGstCents,
      }],
      subtotalExGstCents: unitPrice.subtotalExGstCents,
      gstCents: unitPrice.gstCents,
      totalInclGstCents: unitPrice.totalInclGstCents,
      discountCents: 0,
      designSurchargeCents: 0,
      itemCount: 1,
      cartDigest: "c".repeat(64),
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("CartView", () => {
  beforeEach(() => {
    localStorage.clear();
    analytics.emitAnalyticsEvent.mockClear();
  });

  it("shows a useful empty state", () => {
    render(<CartView market="NZ" />);
    expect(screen.getByRole("heading", { level: 2, name: "Your cart is empty" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse Canvas" })).toHaveAttribute("href", "/canvas");
    expect(screen.getByRole("link", { name: "Browse Banners" })).toHaveAttribute("href", "/banners");
    expect(screen.getByRole("link", { name: "Design Gallery" })).toHaveAttribute("href", "/design-gallery");
  });

  it("uses Australian storefront links for an empty AU cart", () => {
    render(<CartView market="AU" />);

    expect(screen.getByRole("link", { name: "Browse Canvas" }))
      .toHaveAttribute("href", "/au/canvas");
    expect(screen.getByRole("link", { name: "Browse Banners" }))
      .toHaveAttribute("href", "/au/banners");
  });

  it("hides stale NZ totals while automatically repricing an AU cart", async () => {
    seedCart();
    localStorage.setItem("rnr:commerce:v1:guest:checkout:pending", "pending");
    sessionStorage.setItem("rnr:commerce:v1:guest:checkout:payment-intent", "payment");
    const fetchMock = vi.fn().mockResolvedValue(marketResponse("AU"));
    vi.stubGlobal("fetch", fetchMock);

    render(<CartView market="AU" />);

    expect(screen.getByText("Updating cart prices for Australia…")).toBeInTheDocument();
    expect(screen.queryByText("NZ$74.75")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Continue to checkout" }))
      .not.toBeInTheDocument();

    expect(await screen.findAllByText("A$80.00 AUD")).toHaveLength(2);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      market: "AU",
      persistPreference: false,
    });
    expect(JSON.parse(localStorage.getItem("rnr:commerce:v1:guest:cart")!).items[0].price)
      .toMatchObject({ market: "AU", currency: "AUD" });
    expect(localStorage.getItem("rnr:commerce:v1:guest:checkout:pending")).toBeNull();
    expect(sessionStorage.getItem("rnr:commerce:v1:guest:checkout:payment-intent")).toBeNull();
  });

  it("keeps the original cart and blocks checkout when automatic repricing fails", async () => {
    seedCart();
    const original = localStorage.getItem("rnr:commerce:v1:guest:cart");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "The cart could not be repriced for this market.",
      code: "invalid_cart",
    }), { status: 409, headers: { "Content-Type": "application/json" } })));

    render(<CartView market="AU" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The cart could not be repriced for this market.",
    );
    expect(localStorage.getItem("rnr:commerce:v1:guest:cart")).toBe(original);
    expect(screen.queryByRole("link", { name: "Continue to checkout" }))
      .not.toBeInTheDocument();
  });

  it("lets an urgent cart confirm the target-market service before automatic repricing", async () => {
    seedCart();
    const urgent = new Response(JSON.stringify({
      error: "Confirm urgent service or choose another completion date.",
      code: "urgent_confirmation_required",
      issues: [{
        clientItemId: cartItem.id,
        productTitle: cartItem.productTitle,
        neededDate: cartItem.neededDate,
        urgentWorkingDays: 5,
        urgentFeeInclGstCents: 10_000,
        currency: "AUD",
      }],
    }), { status: 409, headers: { "Content-Type": "application/json" } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(urgent)
      .mockResolvedValueOnce(marketResponse("AU"));
    vi.stubGlobal("fetch", fetchMock);

    render(<CartView market="AU" />);

    expect(await screen.findByRole("dialog", { name: "Review urgent service" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Confirm urgent service and switch" }));

    expect(await screen.findAllByText("A$80.00 AUD")).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      market: "AU",
      persistPreference: false,
      cart: {
        items: [expect.objectContaining({ urgentServiceConfirmed: true })],
      },
    });
  });

  it("shows aligned configuration details and totals", async () => {
    seedCart();
    render(<CartView />);

    expect(await screen.findByRole("heading", { name: "Photo Print Canvas" })).toBeInTheDocument();
    expect(screen.getByText("A4 — 29.7 × 21 cm")).toBeInTheDocument();
    expect(screen.getByText("Send Photos After Ordering")).toBeInTheDocument();
    expect(screen.getByText("Production completion date")).toBeInTheDocument();
    expect(screen.queryByText("Needed by")).not.toBeInTheDocument();
    expect(screen.getByText("Subtotal incl GST")).toBeInTheDocument();
    expect(screen.getByText("Includes GST (15%)")).toBeInTheDocument();
    expect(screen.getByText("NZ$9.75")).toBeInTheDocument();
    expect(screen.getAllByText("NZ$74.75")).toHaveLength(2);
    expect(screen.queryByText(/excl GST/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue to checkout" })).toHaveAttribute(
      "href",
      "/checkout/start",
    );
  });

  it("tracks the hydrated identity-scoped cart without exposing its storage key", async () => {
    seedCart();
    render(<CartView />);

    await waitFor(() => expect(analytics.emitAnalyticsEvent).toHaveBeenCalledWith({
      event: "view_cart",
      currency: "NZD",
      value: 65,
      items: [{
        item_id: "photo-print-canvas",
        item_name: "Photo Print Canvas",
        item_variant: "a4",
        price: 65,
        quantity: 1,
      }],
    }));
    expect(JSON.stringify(analytics.emitAnalyticsEvent.mock.calls))
      .not.toContain("rnr:commerce:v1:guest:cart");
  });

  it("shows the chosen design inspiration and preserves its product route", async () => {
    localStorage.setItem(
      "rnr:commerce:v1:guest:cart",
      JSON.stringify({
        version: 1,
        items: [{ ...cartItem, galleryDesignId: "a".repeat(64) }],
      }),
    );
    render(<CartView />);

    expect(await screen.findByText("Selected design inspiration")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View selected design" })).toHaveAttribute(
      "href",
      `/products/photo-print-canvas/configure?design=${"a".repeat(64)}`,
    );
  });

  it("shows privacy-safe Banner Bundle component methods and photo counts", async () => {
    localStorage.setItem(
      "rnr:commerce:v1:guest:cart",
      JSON.stringify({ version: 1, items: [bundleItem] }),
    );
    render(<CartView />);

    const rollUp = await screen.findByLabelText("Roll-Up Banner customisation summary");
    expect(rollUp).toHaveTextContent("Upload Now");
    expect(rollUp).toHaveTextContent("2 photos");
    expect(rollUp).toHaveTextContent("Additional background removal: Yes");
    const wallBanner = screen.getByLabelText("Wall Banner customisation summary");
    expect(wallBanner).toHaveTextContent("Send Later");
    expect(wallBanner).toHaveTextContent("0 photos");
    expect(wallBanner).toHaveTextContent("Additional background removal: No");
    expect(screen.queryByText(/family-secret\.jpg/)).not.toBeInTheDocument();
    expect(screen.queryByText(/blob:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Customer secret/)).not.toBeInTheDocument();
  });

  it("updates quantity and removes an item persistently", async () => {
    seedCart();
    render(<CartView />);
    await screen.findByRole("heading", { name: "Photo Print Canvas" });

    fireEvent.change(screen.getByLabelText("Quantity for Photo Print Canvas"), {
      target: { value: "2" },
    });
    expect(screen.getAllByText("NZ$149.50")).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem("rnr:commerce:v1:guest:cart")!).items[0].quantity).toBe(2);

    analytics.emitAnalyticsEvent.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Remove Photo Print Canvas" }));
    expect(screen.getByRole("heading", { name: "Your cart is empty" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("rnr:commerce:v1:guest:cart")!).items).toEqual([]);
    expect(analytics.emitAnalyticsEvent).toHaveBeenCalledTimes(1);
    expect(analytics.emitAnalyticsEvent).toHaveBeenCalledWith({
      event: "remove_from_cart",
      currency: "NZD",
      value: 130,
      items: [{
        item_id: "photo-print-canvas",
        item_name: "Photo Print Canvas",
        item_variant: "a4",
        price: 65,
        quantity: 2,
      }],
    });
  });

  it("keeps a successful removal when analytics throws", async () => {
    seedCart();
    render(<CartView />);
    await waitFor(() => expect(analytics.emitAnalyticsEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: "view_cart" }),
    ));
    analytics.emitAnalyticsEvent.mockClear();
    analytics.emitAnalyticsEvent.mockImplementationOnce(() => {
      throw new Error("analytics unavailable");
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove Photo Print Canvas" }));

    expect(screen.getByRole("heading", { name: "Your cart is empty" })).toBeVisible();
    expect(JSON.parse(localStorage.getItem("rnr:commerce:v1:guest:cart")!).items)
      .toEqual([]);
  });

  it("re-reads storage before editing so another tab's new item is preserved", async () => {
    seedCart();
    render(<CartView />);
    await screen.findByRole("heading", { name: "Photo Print Canvas" });
    localStorage.setItem("rnr:commerce:v1:guest:cart", JSON.stringify({
      version: 1,
      items: [cartItem, { ...cartItem, id: "item-from-other-tab", productTitle: "Wall Banner" }],
    }));

    fireEvent.change(screen.getByLabelText("Quantity for Photo Print Canvas"), {
      target: { value: "2" },
    });

    expect(JSON.parse(localStorage.getItem("rnr:commerce:v1:guest:cart")!).items).toEqual([
      expect.objectContaining({ id: "item-1", quantity: 2 }),
      expect.objectContaining({ id: "item-from-other-tab", productTitle: "Wall Banner" }),
    ]);
  });
});
