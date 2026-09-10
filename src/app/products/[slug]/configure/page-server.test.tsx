import { beforeEach, expect, it, vi } from "vitest";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import ConfigurePage from "./page";

const mocks = vi.hoisted(() => ({ candidates: vi.fn(), available: vi.fn() }));
vi.mock("@/server/admin/product-registry-runtime", () => ({ getSafePublicProductRegistry: async () => ({ registry: defaultProductRegistry }) }));
vi.mock("@/server/gallery/gallery-runtime", () => ({ getGalleryRuntime: () => ({
  repository: { listActiveCandidates: mocks.candidates },
  store: { isAvailable: mocks.available },
  selectionService: { resolve: async () => null },
}) }));
vi.mock("./page-content", () => ({ ConfigurePageContent: () => null }));

beforeEach(() => { vi.clearAllMocks(); mocks.available.mockResolvedValue(true); });
it("limits oil banner inspiration to eight available designs", async () => {
  const designs = Array.from({ length: 12 }, (_, index) => ({
    id: String(index).padStart(64, "0"), productSlug: "digital-oil-painting-banner",
    storageKey: `managed/${index}.jpg`, contentHash: "b".repeat(64), width: 1600, height: 800,
    altText: "Oil banner example", subOccasion: null,
  }));
  mocks.candidates.mockResolvedValue([...designs, { ...designs[0], id: "other", productSlug: "custom-themed-wall-banner" }]);
  mocks.available.mockImplementation(async (key: string) => key !== "managed/2.jpg");
  const result = await ConfigurePage({ params: Promise.resolve({ slug: "digital-oil-painting-banner" }), searchParams: Promise.resolve({}) });
  expect(result.props.relatedDesigns).toHaveLength(8);
  expect(result.props.relatedDesigns.map((item: { id: string }) => item.id)).toEqual(designs.filter((_, i) => i !== 2).slice(0, 8).map((item) => item.id));
  expect(mocks.available).toHaveBeenCalledTimes(12);
});
