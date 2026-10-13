import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SuppliesSettingsForm } from "./supplies-settings-form";
import { SuppliesProductList } from "./supplies-product-list";
import { SuppliesProductForm } from "./supplies-product-form";
import { SuppliesCategories } from "./supplies-categories";
import { parseSupplyCategoryInput, parseSupplyProductInput } from "@/server/supplies/validation";
import { assertUnchangedSupplyStock } from "@/server/supplies/admin-service";
import type { SupplyVariant } from "@/domain/supplies/types";

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const category = { id: "11111111-1111-4111-8111-111111111111", name: "Canvas materials", slug: "canvas-materials", description: "", sortOrder: 0, visible: false, archived: false, image: null };
const product = {
  id: "product-1", categoryId: category.id, title: "Synthetic canvas fixture", slug: "synthetic-canvas", sku: "TEST-CANVAS",
  shortDescription: "Synthetic fixture", description: "Fixture description", status: "draft" as const,
  priceCents: 1150, salePriceCents: null, trackInventory: false, stockQuantity: null, available: true,
  weightGrams: null, packedLengthMm: null, packedWidthMm: null, packedHeightMm: null,
  pickupAllowed: true, shippingAllowed: false, shippingPriceCents: null,
  seoTitle: "", seoDescription: "", sortOrder: 0, featured: false, variants: [], images: [],
};
const trackedVariant: SupplyVariant = { id: "22222222-2222-4222-8222-222222222222", productId: product.id, sku: "TEST-VARIANT", label: "600 mm", options: { Size: "600 mm" }, priceCents: 2300, salePriceCents: null, active: true, sortOrder: 0, trackInventory: true, stockQuantity: 5, available: true, weightGrams: 1000, packedLengthMm: 700, packedWidthMm: 80, packedHeightMm: 80 };

beforeEach(() => { vi.restoreAllMocks(); push.mockReset(); refresh.mockReset(); });

describe("Supplies admin controls", () => {
  it("keeps the initial OFF state and prevents a manager changing public visibility", () => {
    render(<SuppliesSettingsForm settings={{ enabled: false, updatedAt: null, updatedBy: null }} canPublish={false} />);
    expect(screen.getByRole("checkbox", { name: "Enable Supplies Store" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Enable Supplies Store" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save store visibility" })).toBeDisabled();
  });

  it("persists a deliberate master-switch change and reports server rejection", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "Store cannot be enabled yet" }), { status: 422 }));
    render(<SuppliesSettingsForm settings={{ enabled: false, updatedAt: null, updatedBy: null }} canPublish />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Enable Supplies Store" }));
    fireEvent.click(screen.getByRole("button", { name: "Save store visibility" }));
    await screen.findByRole("alert");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/supplies/settings");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ enabled: true });
    expect(screen.getByRole("alert")).toHaveTextContent("Store cannot be enabled yet");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("filters products by title or SKU and status without fetching again", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<SuppliesProductList categories={[category]} products={[product, { ...product, id: "product-2", title: "Synthetic stand fixture", sku: "TEST-STAND", status: "published" }]} />);
    fireEvent.change(screen.getByLabelText("Search products"), { target: { value: "test-stand" } });
    expect(screen.queryByRole("link", { name: "Edit Synthetic canvas fixture" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit Synthetic stand fixture" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Product status"), { target: { value: "draft" } });
    expect(screen.getByText("No products match these filters.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saves a new product as a draft using NZD minor units and stays in its editor for images", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ product: { ...product, id: "saved-product" } }), { status: 201 }));
    render(<SuppliesProductForm canManagePrices categories={[category]} canPublish={false} canDeleteMedia={false} />);
    fireEvent.change(screen.getByLabelText("Product title"), { target: { value: "Synthetic canvas fixture" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: category.id } });
    fireEvent.change(screen.getByLabelText("SKU"), { target: { value: "TEST-CANVAS" } });
    fireEvent.change(screen.getByLabelText("Public slug"), { target: { value: "synthetic-canvas" } });
    fireEvent.change(screen.getByLabelText("NZD retail price including GST"), { target: { value: "11.50" } });
    expect(screen.queryByRole("button", { name: "Publish product" })).not.toBeInTheDocument();
    expect(screen.getByText(/Save the product as a draft to upload/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/supplies/products/saved-product"));
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ title: "Synthetic canvas fixture", priceCents: 1150, status: "draft", variants: [], trackInventory: false, stockQuantity: null });
    expect(body).not.toHaveProperty("images");
    expect(() => parseSupplyProductInput(body)).not.toThrow();
  });

  it("blocks a sale price above retail before submitting and preserves optional variants", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<SuppliesProductForm canManagePrices product={product} categories={[category]} canPublish canDeleteMedia />);
    fireEvent.click(screen.getByLabelText("Use a sale price"));
    fireEvent.change(screen.getByLabelText("NZD sale price including GST"), { target: { value: "12.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish product" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sale price must be below the retail price.");
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Add variant" }));
    expect(screen.getByLabelText("Variant 1 label")).toBeInTheDocument();
    expect(screen.getByLabelText("Variant 1 option name 1")).toBeInTheDocument();
  });

  it("creates a hidden category and preserves its user-entered slug", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ category: { ...category, id: "new-category" } }), { status: 201 }));
    render(<SuppliesCategories categories={[]} canPublish={false} />);
    fireEvent.change(screen.getByLabelText("Category name"), { target: { value: "Canvas materials" } });
    fireEvent.change(screen.getByLabelText("Category slug"), { target: { value: "canvas-materials" } });
    fireEvent.click(screen.getByRole("button", { name: "Create category" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/supplies/categories");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ name: "Canvas materials", slug: "canvas-materials", visible: false, archived: false });
    expect(() => parseSupplyCategoryInput(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)))).not.toThrow();
  });

  it("rejects category images above 3 MiB before starting an upload", async () => {
    const open = vi.spyOn(XMLHttpRequest.prototype, "open").mockImplementation(() => {});
    vi.spyOn(XMLHttpRequest.prototype, "send").mockImplementation(() => {});
    render(<SuppliesCategories categories={[category]} canPublish={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Canvas materials" }));
    const file = new File(["image"], "oversized.png", { type: "image/png" });
    Object.defineProperty(file, "size", { value: 3 * 1024 * 1024 + 1 });
    fireEvent.change(screen.getByLabelText("Upload category image"), { target: { files: [file] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("3 MiB or smaller");
    expect(open).not.toHaveBeenCalled();
  });

  it("submits edited variants with per-variant stock and packaging accepted by actual backend validation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ product }), { status: 200 }));
    const variant = { id: "22222222-2222-4222-8222-222222222222", productId: product.id, sku: "TEST-VARIANT", label: "600 mm", options: { Size: "600 mm" }, priceCents: 2300, salePriceCents: null, active: true, sortOrder: 0, trackInventory: true, stockQuantity: 5, available: true, weightGrams: 1000, packedLengthMm: 700, packedWidthMm: 80, packedHeightMm: 80 };
    render(<SuppliesProductForm canManagePrices product={{ ...product, shippingAllowed: true, variants: [variant] }} categories={[category]} canPublish canDeleteMedia />);
    fireEvent.change(screen.getByLabelText("Variant 1 stock quantity"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Variant 1 option value 1"), { target: { value: " 650 mm " } });
    fireEvent.click(screen.getByRole("button", { name: "Publish product" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.status).toBe("published");
    expect(body).toHaveProperty("expectedStockQuantity", null);
    expect(body.variants[0]).toMatchObject({ id: variant.id, stockQuantity: 7, expectedStockQuantity: 5, priceCents: 2300, options: { Size: "650 mm" }, packedLengthMm: 700 });
    expect(body.variants[0]).not.toHaveProperty("productId");
    expect(body.variants[0]).not.toHaveProperty("key");
    expect(() => parseSupplyProductInput(body)).not.toThrow();
  });

  it("retains server errors on saving a product without navigating away", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "SKU already exists" }), { status: 409 }));
    render(<SuppliesProductForm canManagePrices product={product} categories={[category]} canPublish={false} canDeleteMedia={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("SKU already exists");
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByLabelText("SKU")).toHaveValue("TEST-CANVAS");
  });

  it("reuses the persisted variant ID when saving a newly added variant twice", async () => {
    const savedProduct = { ...product, variants: [trackedVariant] };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ product: savedProduct }), { status: 200 }));
    const props = { product, categories: [category], canManagePrices: true, canPublish: false, canDeleteMedia: false };
    const { rerender } = render(<SuppliesProductForm {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Add variant" }));
    fireEvent.change(screen.getByLabelText("Variant 1 label"), { target: { value: "600 mm" } });
    fireEvent.change(screen.getByLabelText("Variant 1 SKU"), { target: { value: "TEST-VARIANT" } });
    fireEvent.change(screen.getByLabelText("Variant 1 retail price including GST"), { target: { value: "23.00" } });
    fireEvent.click(screen.getByLabelText("Variant 1 track inventory"));
    fireEvent.change(screen.getByLabelText("Variant 1 stock quantity"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByRole("status");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).variants[0]).not.toHaveProperty("id");
    rerender(<SuppliesProductForm {...props} product={savedProduct} />);
    fireEvent.change(screen.getByLabelText("Product title"), { target: { value: "Updated title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByRole("status");
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(secondBody.variants).toHaveLength(1);
    expect(secondBody.variants[0]).toMatchObject({ id: trackedVariant.id, stockQuantity: 5, expectedStockQuantity: 5 });
    expect(() => parseSupplyProductInput(secondBody)).not.toThrow();
  });

  it.each(["base product", "variant"])("preserves a dirty draft baseline when refreshed props contain a concurrent %s stock decrease", async (stockOwner) => {
    const original = { ...product, trackInventory: true, stockQuantity: 10, variants: [trackedVariant] };
    const latest = { ...original, stockQuantity: stockOwner === "base product" ? 8 : 10, variants: [{ ...trackedVariant, stockQuantity: stockOwner === "variant" ? 3 : 5 }] };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const input = parseSupplyProductInput(JSON.parse(String(init?.body)));
      try {
        assertUnchangedSupplyStock(latest, input);
        assertUnchangedSupplyStock(latest.variants[0], input.variants[0]);
        return new Response(JSON.stringify({ product: latest }), { status: 200 });
      } catch (error) {
        return new Response(JSON.stringify({ error: (error as Error).message }), { status: 409 });
      }
    });
    const props = { categories: [category], canManagePrices: true, canPublish: false, canDeleteMedia: false };
    const { rerender } = render(<SuppliesProductForm {...props} product={original} />);
    fireEvent.change(screen.getByLabelText("Product title"), { target: { value: "My unsaved title" } });
    rerender(<SuppliesProductForm {...props} product={latest} />);
    expect(screen.getByLabelText("Product title")).toHaveValue("My unsaved title");
    expect(screen.getByLabelText("Product stock quantity")).toHaveValue(10);
    expect(screen.getByLabelText("Variant 1 stock quantity")).toHaveValue(5);
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Stock changed while this editor was open. Refresh before saving.");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ stockQuantity: 10, expectedStockQuantity: 10 });
    expect(body.variants[0]).toMatchObject({ stockQuantity: 5, expectedStockQuantity: 5 });
    expect(screen.getByLabelText("Product title")).toHaveValue("My unsaved title");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("adopts returned stock values and their baselines together after its own successful save", async () => {
    const original = { ...product, trackInventory: true, stockQuantity: 10, variants: [trackedVariant] };
    const persisted = { ...original, title: "Server normalized title", priceCents: 2000, stockQuantity: 8, variants: [{ ...trackedVariant, stockQuantity: 3 }] };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ product: persisted }), { status: 200 }));
    render(<SuppliesProductForm product={original} categories={[category]} canManagePrices canPublish={false} canDeleteMedia={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByRole("status");
    expect(screen.getByLabelText("Product stock quantity")).toHaveValue(8);
    expect(screen.getByLabelText("Variant 1 stock quantity")).toHaveValue(3);
    expect(screen.getByLabelText("Product title")).toHaveValue("Server normalized title");
    expect(screen.getByLabelText("NZD retail price including GST")).toHaveValue("20.00");
    fireEvent.change(screen.getByLabelText("Product title"), { target: { value: "Another edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByRole("status");
    const body = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(body).toMatchObject({ title: "Another edit", stockQuantity: 8, expectedStockQuantity: 8 });
    expect(body.variants[0]).toMatchObject({ id: trackedVariant.id, stockQuantity: 3, expectedStockQuantity: 3 });
  });

  it("adds optional variants on the HTTP LAN origin without crypto.randomUUID", () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    try {
      render(<SuppliesProductForm canManagePrices product={product} categories={[category]} canPublish canDeleteMedia />);
      fireEvent.click(screen.getByRole("button", { name: "Add variant" }));
      expect(screen.getByLabelText("Variant 1 label")).toBeInTheDocument();
    } finally { vi.unstubAllGlobals(); }
  });

  it("does not allow a content publisher without pricing permission to save products", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<SuppliesProductForm canManagePrices={false} product={product} categories={[category]} canPublish canDeleteMedia />);
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Publish product" })).toBeDisabled();
    expect(screen.getByLabelText("NZD retail price including GST")).toBeDisabled();
    fireEvent.submit(screen.getByRole("button", { name: "Save draft" }).closest("form")!);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
