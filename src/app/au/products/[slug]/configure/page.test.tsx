import { expect, it, vi } from "vitest";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import AustraliaConfigurePage from "./page";
vi.mock("@/server/admin/product-registry-runtime", () => ({ getSafePublicProductRegistry: async () => ({ registry: { ...defaultProductRegistry, markets: { ...defaultProductRegistry.markets, AU: { ...defaultProductRegistry.markets.AU, enabled: true } } } }) }));
vi.mock("@/domain/catalogue/market-price-book", async (importOriginal) => ({ ...await importOriginal<typeof import("@/domain/catalogue/market-price-book")>(), getMarketCompleteness: () => ({ ready: true }) }));
vi.mock("@/server/gallery/gallery-runtime", () => ({ getGalleryRuntime: () => ({ selectionService: { resolve: async () => null } }) }));
vi.mock("@/app/products/[slug]/configure/page-content", () => ({ ConfigurePageContent: () => null }));
it("passes the Australian cart edit and size selection to the client editor", async () => {
  const result = await AustraliaConfigurePage({ params: Promise.resolve({ slug: "photo-print-canvas" }), searchParams: Promise.resolve({ edit: "cart-item", size: "a4" }) });
  expect(result.props).toMatchObject({ market: "AU", editItemId: "cart-item", initialSizeKey: "a4" });
});
