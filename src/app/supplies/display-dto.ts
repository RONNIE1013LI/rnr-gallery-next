import type { SuppliesCatalogue, SupplyImage, SupplyProduct } from "@/domain/supplies/types";

const displayImage = (image: SupplyImage): SupplyImage => ({ ...image, storageKey: "" });
export function supplyProductDisplayDto(product: SupplyProduct): SupplyProduct {
  return { ...product, images: product.images.map(displayImage) };
}

/** Product views receive proxy URLs, never private Blob pathnames or administrator identifiers. */
export function suppliesDisplayDto(catalogue: SuppliesCatalogue): SuppliesCatalogue {
  return {
    settings: { enabled: catalogue.settings.enabled, updatedBy: null, updatedAt: null },
    categories: catalogue.categories.map((category) => ({ ...category, image: category.image ? displayImage(category.image) : null })),
    products: catalogue.products.map(supplyProductDisplayDto),
  };
}
