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

function seedCart() {
  localStorage.setItem(
    "rnr-cart-v1",
    JSON.stringify({ version: 1, items: [cartItem] }),
  );
}

describe("CartView", () => {
  beforeEach(() => localStorage.clear());

  it("shows a useful empty state", () => {
    render(<CartView />);
    expect(screen.getByRole("heading", { name: "Your cart is empty" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Explore products" })).toHaveAttribute("href", "/shop");
  });

  it("shows aligned configuration details and totals", async () => {
    seedCart();
    render(<CartView />);

    expect(await screen.findByRole("heading", { name: "Photo Print Canvas" })).toBeInTheDocument();
    expect(screen.getByText("A4 — 29.7 × 21 cm")).toBeInTheDocument();
    expect(screen.getByText("Send after ordering")).toBeInTheDocument();
    expect(screen.getByText("$65.00")).toBeInTheDocument();
    expect(screen.getByText("$9.75")).toBeInTheDocument();
    expect(screen.getByText("$74.75")).toBeInTheDocument();
  });

  it("shows the chosen design inspiration and preserves its product route", async () => {
    localStorage.setItem(
      "rnr-cart-v1",
      JSON.stringify({
        version: 1,
        items: [{ ...cartItem, galleryDesignId: "a".repeat(64) }],
      }),
    );
    render(<CartView />);

    expect(await screen.findByText("Selected design inspiration")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View selected design" })).toHaveAttribute(
      "href",
      `/products/photo-print-canvas?design=${"a".repeat(64)}`,
    );
  });

  it("updates quantity and removes an item persistently", async () => {
    seedCart();
    render(<CartView />);
    await screen.findByRole("heading", { name: "Photo Print Canvas" });

    fireEvent.change(screen.getByLabelText("Quantity for Photo Print Canvas"), {
      target: { value: "2" },
    });
    expect(screen.getByText("$149.50")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("rnr-cart-v1")!).items[0].quantity).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: "Remove Photo Print Canvas" }));
    expect(screen.getByRole("heading", { name: "Your cart is empty" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("rnr-cart-v1")!).items).toEqual([]);
  });
});
