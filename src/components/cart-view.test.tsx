import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { calculateFixedPackage } from "@/domain/pricing/calculate-fixed-package";
import type { CartItem } from "@/domain/cart/types";
import { generatedSrcsetDescriptors } from "@/test/image-candidate-assertions";
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

describe("CartView", () => {
  beforeEach(() => {
    localStorage.clear();
    analytics.emitAnalyticsEvent.mockClear();
  });

  it.each(["later", "upload"] as const)("labels failed product images for %s photo submission", (method) => {
    localStorage.setItem("rnr:commerce:v1:guest:cart", JSON.stringify({ version: 1, items: [{ ...cartItem, photoSubmissionMethod: method }] }));
    const { container } = render(<CartView market="NZ" />);
    const image = container.querySelector("img")!;
    fireEvent.error(image);
    expect(screen.getByText("Custom artwork")).toBeVisible();
    expect(screen.getByRole("img", { name: "Photo Print Canvas preview unavailable" })).toBeVisible();
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

  it("uses Australian storefront links for an empty AU cart", () => {
    render(<CartView market="AU" />);

    expect(screen.getByRole("link", { name: "Browse Canvas" }))
      .toHaveAttribute("href", "/au/canvas");
    expect(screen.getByRole("link", { name: "Browse Banners" }))
      .toHaveAttribute("href", "/au/banners");
  });

  it.each([false, true])("never reprices or mutates a configured cart on mount (rush %s)", async (rush) => {
    const configured = { ...cartItem, urgentServiceConfirmed: rush, productionWorkingDays: rush ? 2 : 10, urgentFeeInclGstCents: rush ? 10000 : 0, eventDate: "2020-01-01" };
    localStorage.setItem("rnr:commerce:v1:guest:cart", JSON.stringify({ version: 1, items: [configured] }));
    const original = localStorage.getItem("rnr:commerce:v1:guest:cart");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { container, rerender } = render(<CartView market="NZ" />);
    expect(screen.getByRole("link", { name: "Continue to checkout" })).toBeVisible();
    rerender(<CartView market="AU" />);
    await waitFor(() => expect(screen.getByText(/Your cart keeps its configured prices/)).toBeVisible());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("rnr:commerce:v1:guest:cart")).toBe(original);
    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(screen.queryByRole("button", { name: /urgent|rush/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Continue to checkout" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit configuration for Photo Print Canvas" })).toHaveAttribute("href", "/au/products/photo-print-canvas/configure?edit=item-1&size=a4");
    expect(screen.getAllByText("NZ$74.75")).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it.each([false, true])("preserves the configured service and timing when quantity changes (%s)", (rush) => {
    const configured = { ...cartItem, urgentServiceConfirmed: rush, productionWorkingDays: rush ? 2 : 10, urgentFeeInclGstCents: rush ? 10000 : 0, eventDate: "2020-01-01" };
    localStorage.setItem("rnr:commerce:v1:guest:cart", JSON.stringify({ version: 1, items: [configured] }));
    render(<CartView market="NZ" />);
    fireEvent.change(screen.getByRole("combobox", { name: "Quantity for Photo Print Canvas" }), { target: { value: "3" } });
    expect(JSON.parse(localStorage.getItem("rnr:commerce:v1:guest:cart")!).items[0]).toEqual({ ...configured, quantity: 3 });
  });

  it("preserves the AU product, size and design in its configuration return link", () => {
    localStorage.setItem("rnr:commerce:v1:guest:cart", JSON.stringify({ version: 1, items: [{ ...cartItem, price: marketPrice("AU"), galleryDesignId: "a".repeat(64) }] }));
    render(<CartView market="AU" />);
    expect(screen.getByRole("link", { name: "Edit configuration for Photo Print Canvas" })).toHaveAttribute("href", `/au/products/photo-print-canvas/configure?edit=item-1&size=a4&design=${"a".repeat(64)}`);
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
    expect(screen.getByText("Estimated production completion")).toBeInTheDocument();
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
