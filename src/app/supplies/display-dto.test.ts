import { describe, expect, it } from "vitest";
import type { SuppliesCatalogue, SupplyImage, SupplyProduct } from "@/domain/supplies/types";
import { suppliesDisplayDto } from "./display-dto";

describe("public supplies display data", () => {
  it("does not serialize administrator identifiers or private Blob keys", () => {
    const image: SupplyImage = { id: "image", storageKey: "private-supplies-path", productId: "product", categoryId: null, url: "/api/supplies/images/image", altText: "Synthetic", width: 200, height: 200, sortOrder: 0, isCover: true };
    const product: SupplyProduct = {
      id: "product", categoryId: "category", title: "Synthetic", slug: "synthetic", sku: "TEST", shortDescription: "", description: "",
      status: "published", priceCents: 1150, salePriceCents: null, pickupAllowed: true, shippingAllowed: false,
      seoTitle: "", seoDescription: "", sortOrder: 0, featured: false, trackInventory: false, stockQuantity: null, available: true,
      weightGrams: null, packedLengthMm: null, packedWidthMm: null, packedHeightMm: null, variants: [], images: [image],
    };
    const catalogue: SuppliesCatalogue = { settings: { enabled: true, updatedBy: "private-admin-id", updatedAt: "private-admin-time" }, categories: [{ id: "category", name: "Synthetic", slug: "synthetic", description: "", visible: true, archived: false, sortOrder: 0, image }], products: [product] };
    const display = suppliesDisplayDto(catalogue);
    const serialized = JSON.stringify(display);
    expect(serialized).not.toContain("private-admin");
    expect(serialized).not.toContain("private-supplies-path");
    expect(display.products[0].images[0].url).toBe("/api/supplies/images/image");
    expect(catalogue.products[0].images[0].storageKey).toBe("private-supplies-path");
  });
});
