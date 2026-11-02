import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateFixedPackage } from "@/domain/pricing/calculate-fixed-package";
import type { CustomCartItem } from "@/domain/cart/types";
import { generatedSrcsetDescriptors } from "@/test/image-candidate-assertions";
import { notifyCartChanged } from "@/domain/cart/browser-cart-events";
import { setActiveCustomerId } from "@/domain/cart/browser-cart-scope";
import { readActiveVoucherCode } from "@/domain/cart/checkout-promotion";
import { CartView } from "./cart-view";

const analytics = vi.hoisted(() => ({
  emitAnalyticsEvent: vi.fn<(event: unknown) => boolean>(() => true),
}));

vi.mock("@/domain/analytics/client", () => analytics);

const cartItem: CustomCartItem = {
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

const bundleItem: CustomCartItem = {
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
  afterEach(() => { setActiveCustomerId(null); vi.restoreAllMocks(); });
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
      const payload = await marketResponse("NZ").json();
      const quantity = JSON.parse(String(options.body)).cart.items[0]?.quantity ?? 1;
      return Response.json({ ...payload, signedIn: false, cart: { ...payload.cart,
        totalInclGstCents: 7475 * quantity, gstCents: 975 * quantity } });
    }));
    analytics.emitAnalyticsEvent.mockClear();
  });

  it("shows a useful empty state", () => {
    render(<CartView market="NZ" />);
    const heading = screen.getByRole("heading", { level: 2, name: "Your cart is empty" });
    expect(heading).toBeInTheDocument();
    expect(heading.closest("section")).toHaveAttribute("aria-labelledby", "empty-cart-title");
    expect(screen.getByRole("link", { name: "Browse Canvas" })).toHaveAttribute("href", "/canvas");
    expect(screen.getByRole("link", { name: "Browse Banners" })).toHaveAttribute("href", "/banners");
    expect(screen.getByRole("link", { name: "Design Gallery" })).toHaveAttribute("href", "/design-gallery");
  });

  it("shows the server first-order discount without changing canonical cart prices", async () => {
    seedCart();
    const original = localStorage.getItem("rnr:commerce:v1:guest:cart");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      const payload = await marketResponse("NZ").json();
      return Response.json({ signedIn: true, cart: { ...payload.cart,
        totalInclGstCents: 5980, gstCents: 780, discountCents: 1495,
        promotion: { key: "first-order-20-v1", percentage: 20 },
      } });
    }));
    render(<CartView />);
    expect(await screen.findByText("First-order discount (20%)")).toBeVisible();
    expect(screen.getByText("−NZ$14.95")).toBeVisible();
    expect(screen.getByText("NZ$59.80")).toBeVisible();
    expect(localStorage.getItem("rnr:commerce:v1:guest:cart")).toBe(original);
  });

  it("applies a returning voucher through the server and removes it", async () => {
    seedCart();
    const fetchMock = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
      const payload = await marketResponse("NZ").json();
      const code = JSON.parse(String(options.body)).voucherCode;
      return Response.json({ signedIn: true, cart: code ? { ...payload.cart,
        totalInclGstCents: 4784, gstCents: 624, discountCents: 2691,
        promotion: { key: "returning-customer-36-v1", percentage: 36,
          baseDiscountCents: 1495, extraDiscountCents: 1196 },
      } : payload.cart });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<CartView />);
    fireEvent.change(screen.getByLabelText("Returning customer voucher"), { target: { value: "oldcustomercode" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply voucher" }));
    expect(await screen.findByText("Returning customer discount (20%)")).toBeVisible();
    expect(screen.getByText("Extra discount (20% after base discount)")).toBeVisible();
    expect(screen.getByText("NZ$47.84")).toBeVisible();
    expect(readActiveVoucherCode()).toBe("oldcustomercode");
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/cart/quote");
    fireEvent.click(screen.getByRole("button", { name: "Remove voucher" }));
    await waitFor(() => expect(screen.queryByText("Returning customer discount (20%)")).not.toBeInTheDocument());
    await screen.findByRole("link", { name: "Continue to checkout" });
    expect(JSON.parse(fetchMock.mock.calls.at(-1)?.[1].body).voucherCode).toBeUndefined();
    expect(readActiveVoucherCode()).toBe("");
  });

  it("blocks stale totals on quote failure and supports retry with a guest sign-in prompt", async () => {
    seedCart();
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ error: { message: "Quote unavailable" } }, { status: 503 }))
      .mockImplementation(async () => { const payload = await marketResponse("NZ").json(); return Response.json({ ...payload, signedIn: false }); });
    vi.stubGlobal("fetch", fetchMock);
    render(<CartView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Quote unavailable");
    expect(screen.queryByRole("link", { name: "Continue to checkout" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry quote" }));
    expect(await screen.findByRole("link", { name: "Sign in for account offers" })).toHaveAttribute("href", "/account/sign-in?next=%2Fcart");
    expect(await screen.findByRole("link", { name: "Continue to checkout" })).toBeVisible();
  });

  it("rechecks offers when the account changes with an identical cart", async () => {
    seedCart();
    localStorage.setItem("rnr:commerce:v1:user:another-account:cart", localStorage.getItem("rnr:commerce:v1:guest:cart")!);
    const fetchMock = vi.fn().mockImplementation(async () => marketResponse("NZ"));
    vi.stubGlobal("fetch", fetchMock);
    render(<CartView />);
    await screen.findByRole("link", { name: "Continue to checkout" });
    act(() => { setActiveCustomerId("another-account"); notifyCartChanged(); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("does not save a rejected code and can remove the failed request", async () => {
    seedCart();
    const fetchMock = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
      return JSON.parse(String(options.body)).voucherCode
        ? Response.json({ error: { message: "Voucher belongs to another account" } }, { status: 403 })
        : marketResponse("NZ");
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<CartView />);
    await screen.findByRole("link", { name: "Continue to checkout" });
    fireEvent.change(screen.getByLabelText("Returning customer voucher"), { target: { value: "invalid-code" } });
    fireEvent.submit(screen.getByLabelText("Returning customer voucher").closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Voucher belongs to another account");
    expect(readActiveVoucherCode()).toBe("");
    expect(screen.queryByRole("link", { name: "Continue to checkout" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove voucher" }));
    await screen.findByRole("link", { name: "Continue to checkout" });
  });

  it("ignores an older response after the cart quantity changes", async () => {
    seedCart();
    let resolveFirst!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveFirst = resolve; }))
      .mockImplementation(async () => { const payload = await marketResponse("NZ").json(); return Response.json({ ...payload, cart: { ...payload.cart, totalInclGstCents: 14950 } }); });
    vi.stubGlobal("fetch", fetchMock);
    render(<CartView />);
    fireEvent.change(screen.getByLabelText("Quantity for Photo Print Canvas"), { target: { value: "2" } });
    expect(await screen.findAllByText("NZ$149.50")).toHaveLength(2);
    await act(async () => { resolveFirst(marketResponse("NZ")); });
    expect(screen.getAllByText("NZ$149.50")).toHaveLength(2);
    expect(screen.queryByText("NZ$74.75")).not.toBeInTheDocument();
  });

  it("does not offer checkout when a validated voucher cannot be retained", async () => {
    seedCart();
    const fetchMock = vi.fn().mockImplementation(async () => {
      const payload = await marketResponse("NZ").json();
      return Response.json({ signedIn: true, cart: { ...payload.cart,
        totalInclGstCents: 4784, discountCents: 2691,
        promotion: { key: "returning-customer-36-v1", percentage: 36, baseDiscountCents: 1495, extraDiscountCents: 1196 },
      } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<CartView />);
    await screen.findByRole("link", { name: "Continue to checkout" });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
    fireEvent.change(screen.getByLabelText("Returning customer voucher"), { target: { value: "valid-code" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply voucher" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your voucher could not be saved for checkout");
    expect(screen.queryByRole("link", { name: "Continue to checkout" })).not.toBeInTheDocument();
    expect(screen.queryByText("Voucher applied. Your account offer is included below.")).not.toBeInTheDocument();
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
    const fetchMock = vi.fn().mockImplementation(async () => marketResponse("AU"));
    vi.stubGlobal("fetch", fetchMock);

    render(<CartView market="AU" />);

    expect(screen.getByText("Updating cart prices for Australia…")).toBeInTheDocument();
    expect(screen.queryByText("NZ$74.75")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Continue to checkout" }))
      .not.toBeInTheDocument();

    expect(await screen.findAllByText("A$80.00 AUD")).toHaveLength(2);
    expect(screen.queryByText("GST not charged")).not.toBeInTheDocument();
    expect(screen.queryByText("A$0.00 AUD")).not.toBeInTheDocument();
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
      .mockImplementation(async () => marketResponse("AU"));
    vi.stubGlobal("fetch", fetchMock);

    render(<CartView market="AU" />);

    expect(await screen.findByRole("dialog", { name: "Review urgent service" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Confirm urgent service and switch" }));

    expect(await screen.findAllByText("A$80.00 AUD")).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([url]) => url !== "/api/cart/quote")).toHaveLength(2);
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
    const { container } = render(<CartView />);

    expect(await screen.findByRole("heading", { name: "Photo Print Canvas" })).toBeInTheDocument();
    const thumbnail = container.querySelector("article img");
    expect(thumbnail).toHaveAttribute("width", "96");
    expect(thumbnail).toHaveAttribute("height", "96");
    expect(thumbnail).not.toHaveAttribute("sizes");
    expect(generatedSrcsetDescriptors(thumbnail as HTMLElement)).toEqual(["1x", "2x"]);
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
    expect(await screen.findAllByText("NZ$149.50")).toHaveLength(2);
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
