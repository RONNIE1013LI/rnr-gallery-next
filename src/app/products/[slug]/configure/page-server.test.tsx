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
    id: String(index).padStart(64, "0"), productSlug: "digital-oil-painting-banner", productTypeSlug: "wall-hanging-banners",
    storageKey: `managed/${index}.jpg`, contentHash: "b".repeat(64), width: 1600, height: 800,
    altText: "Oil banner example", subOccasion: null,
  }));
  mocks.candidates.mockResolvedValue([...designs, { ...designs[0], id: "other", productSlug: "custom-themed-wall-banner" }]);
  mocks.available.mockImplementation(async (key: string) => key !== "managed/2.jpg");
  const result = await ConfigurePage({ params: Promise.resolve({ slug: "digital-oil-painting-banner" }), searchParams: Promise.resolve({}) });
  expect(result.props.relatedDesigns).toHaveLength(8);
  expect(result.props.relatedDesigns.map((item: { id: string }) => item.id)).toEqual(designs.filter((_, i) => i !== 2).slice(0, 8).map((item) => item.id));
  expect(mocks.available).toHaveBeenCalledTimes(13);
});

it.each([
  ["digital-oil-painting-banner", "wall-hanging-banners", "custom-themed-wall-banner"],
  ["custom-themed-wall-banner", "wall-hanging-banners", "digital-oil-painting-banner"],
  ["roll-up-banner", "roll-up-banner", "roll-up-banner"],
  ["grave-cover", "grave-cover", "grave-cover"],
  ["digital-oil-painting-canvas", "canvas", "custom-themed-canvas"],
  ["custom-themed-canvas", "canvas", "digital-oil-painting-canvas"],
  ["photo-print-canvas", "canvas", "digital-oil-painting-canvas"],
])("shows available family designs for %s", async (slug, productTypeSlug, productSlug) => {
  const design = { id: "a".repeat(64), productSlug, productTypeSlug,
    storageKey: "managed/family.jpg", contentHash: "b".repeat(64),
    width: 1200, height: 1600, altText: "Family design", subOccasion: null };
  mocks.candidates.mockResolvedValue([design, { ...design, id: "wrong-family", productTypeSlug: "unrelated" }]);
  const result = await ConfigurePage({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({}) });
  expect(result.props.relatedDesigns).toEqual([expect.objectContaining({
    id: design.id, imageUrl: `/gallery-images/${design.id}?v=${design.contentHash}`, productSlug,
  })]);
});
it("falls back when exact style images are unavailable and prefers available exact styles", async () => {
  const family = { id: "family", productSlug: "custom-themed-wall-banner", productTypeSlug: "wall-hanging-banners",
    storageKey: "family.jpg", contentHash: "hash", width: 1200, height: 1600, altText: "Banner", subOccasion: null };
  const exact = { ...family, id: "exact", productSlug: "digital-oil-painting-banner", storageKey: "exact.jpg" };
  mocks.candidates.mockResolvedValue([family, exact]);
  const props = { params: Promise.resolve({ slug: "digital-oil-painting-banner" }), searchParams: Promise.resolve({}) };
  expect((await ConfigurePage(props)).props.relatedDesigns.map((d: { id: string }) => d.id)).toEqual(["exact", "family"]);
  mocks.available.mockImplementation(async (key: string) => key !== "exact.jpg");
  expect((await ConfigurePage(props)).props.relatedDesigns.map((d: { id: string }) => d.id)).toEqual(["family"]);
});
