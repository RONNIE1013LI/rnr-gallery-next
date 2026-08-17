import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { calculateFixedPackage } from "@/domain/pricing/calculate-fixed-package";
import type { CartItem } from "@/domain/cart/types";
import { CartView } from "./cart-view";

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

describe("CartView", () => {
  beforeEach(() => localStorage.clear());

  it("shows a useful empty state", () => {
    render(<CartView />);
    expect(screen.getByRole("heading", { level: 2, name: "Your cart is empty" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse Canvas" })).toHaveAttribute("href", "/canvas");
    expect(screen.getByRole("link", { name: "Browse Banners" })).toHaveAttribute("href", "/banners");
    expect(screen.getByRole("link", { name: "Design Gallery" })).toHaveAttribute("href", "/design-gallery");
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

    fireEvent.click(screen.getByRole("button", { name: "Remove Photo Print Canvas" }));
    expect(screen.getByRole("heading", { name: "Your cart is empty" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("rnr:commerce:v1:guest:cart")!).items).toEqual([]);
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
