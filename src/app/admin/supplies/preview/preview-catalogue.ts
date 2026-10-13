import { getAdminSuppliesCatalogue } from "@/server/supplies/catalogue";
import { SuppliesSchemaPendingError } from "@/server/supplies/errors";

export async function loadPreviewCatalogue(includeDrafts: boolean) {
  try {
    // The admin loader verifies manage_content on every call and never shares its cache.
    const catalogue = await getAdminSuppliesCatalogue(includeDrafts);
    const categories = catalogue.categories.filter((category) => !category.archived);
    const categoryIds = new Set(categories.map((category) => category.id));
    return { ...catalogue, categories, products: catalogue.products.filter((product) => product.status !== "archived" && categoryIds.has(product.categoryId)) };
  } catch (error) { if (error instanceof SuppliesSchemaPendingError) return null; throw error; }
}
