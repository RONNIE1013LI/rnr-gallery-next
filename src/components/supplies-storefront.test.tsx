import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import type { SupplyProduct } from "@/domain/supplies/types";
import { CART_STORAGE_KEY } from "@/domain/cart/types";

vi.mock("next/image", () => ({ default: ({ src, alt }: { src: string; alt: string }) => createElement("img", { src, alt }) }));
import { SupplyProductDetail, SuppliesStorefront } from "./supplies-storefront";

export const product: SupplyProduct = {
  id: "d9553137-718d-4692-8268-3cbeeeed1b26", categoryId: "category", title: "Test stand", slug: "test-stand", sku: "TEST-01",
  shortDescription: "Display hardware", description: "Synthetic product for testing.", status: "published",
  priceCents: 1150, salePriceCents: null, pickupAllowed: true, shippingAllowed: false,
  seoTitle: "", seoDescription: "", sortOrder: 0, featured: false, trackInventory: true, stockQuantity: 3, available: true,
  weightGrams: null, packedLengthMm: null, packedWidthMm: null, packedHeightMm: null, variants: [],
  images: [{ id: "image", productId: "product", categoryId: null, url: "/api/supplies/images/image", storageKey: "private-key", width: 600, height: 600, altText: "Test stand", sortOrder: 0, isCover: true }],
};

beforeEach(() => window.localStorage.clear());

describe("Supplies shared storefront", () => {
  it("uses admin preview links and renders the same catalogue cards", () => {
    render(<SuppliesStorefront catalogue={{ settings: { enabled: false, updatedAt: null, updatedBy: null }, categories: [], products: [product] }} preview includeDrafts />);
    expect(screen.getByRole("heading", { name: "Canvas & Display Supplies" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View Product" })).toHaveAttribute("href", "/admin/supplies/preview/products/test-stand?drafts=1");
  });

  it("preview quantity and variants never write the real cart", () => {
    render(<SupplyProductDetail product={product} categoryName="Roll-Up Banner Stands Only" preview />);
    expect(screen.getByText("Stand Only — No Printed Banner Included")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Quantity" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview Add to Cart" }));
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Preview only");
    expect(screen.queryByLabelText("Specification")).toBeNull();
  });

  it("stores a standard item with selected quantity, tax and no custom fields", () => {
    render(<SupplyProductDetail product={product} categoryName="Supplies" />);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Quantity" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));
    const cart = JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY)!);
    expect(cart.items[0]).toMatchObject({ kind: "supply", supplyProductId: product.id, quantity: 2, deliveryPreference: "pickup", price: { totalInclGstCents: 1150, gstCents: 150 } });
    expect(cart.items[0]).not.toHaveProperty("photoSubmissionMethod");
  });

  it("uses variant price and SKU and rejects quantities over available stock", () => {
    const variant = { ...product, id: "variant", productId: product.id, label: "Large", options: { Size: "Large" }, active: true, priceCents: 2300, sku: "TEST-L", stockQuantity: 1 };
    render(<SupplyProductDetail product={{ ...product, variants: [variant] }} categoryName="Supplies" />);
    expect(screen.getByText("NZ$23.00")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Quantity" }), { target: { value: "2" } });
    expect(screen.getByRole("button", { name: "Add to Cart" })).toBeDisabled();
  });

  it("keeps an unavailable product out of the cart", () => {
    render(<SupplyProductDetail product={{ ...product, stockQuantity: 0 }} categoryName="Supplies" />);
    expect(screen.getByRole("button", { name: "Add to Cart" })).toBeDisabled();
    expect(screen.getByText("Out of stock")).toBeInTheDocument();
  });

  it("supports the LAN preview URL where randomUUID is unavailable", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: { getRandomValues: (bytes: Uint8Array) => bytes.fill(7) } });
    try {
      render(<SupplyProductDetail product={product} categoryName="Supplies" />);
      fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));
      expect(JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY)!).items[0].id).toMatch(/^[a-f0-9-]{36}$/);
    } finally { if (original) Object.defineProperty(globalThis, "crypto", original); }
  });
});
