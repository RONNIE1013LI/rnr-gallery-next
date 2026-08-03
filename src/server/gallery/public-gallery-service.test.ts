import { describe, expect, it } from "vitest";
import type {
  GalleryPublicCandidate,
  GalleryRepository,
} from "./gallery-repository";
import { createPublicGalleryService } from "./public-gallery-service";

function candidate(
  id: number,
  overrides: Partial<GalleryPublicCandidate> = {},
): GalleryPublicCandidate {
  return {
    id: id.toString(16).padStart(64, "0"),
    productTypeSlug: "canvas",
    occasionSlug: "memorial",
    subOccasion: null,
    themeSlugs: [],
    altText: `Artwork ${id}`,
    productSlug: "digital-oil-painting-canvas",
    storageKey: `generations/${"a".repeat(64)}/${id}.jpg`,
    contentHash: id.toString(16).padStart(64, "0"),
    mimeType: "image/jpeg",
    width: 100,
    height: 150,
    createdAt: new Date(`2026-08-${String(Math.min(id, 28)).padStart(2, "0")}T00:00:00Z`),
    ...overrides,
  };
}

function repository(rows: readonly GalleryPublicCandidate[]): GalleryRepository {
  return {
    replaceInitialImport: async () => ({ imported: 0, unchanged: 0 }),
    listActiveCandidates: async () => rows,
  };
}

describe("public gallery service", () => {
  it("uses OR within groups, AND between groups, and excludes unavailable images", async () => {
    const rows = [
      candidate(1, { occasionSlug: "memorial", themeSlugs: ["cultural-island"] }),
      candidate(2, { occasionSlug: "birthday", subOccasion: "21st Birthday", themeSlugs: ["cultural-island"] }),
      candidate(3, { productTypeSlug: "roll-up-banner", productSlug: "roll-up-banner", occasionSlug: "birthday", subOccasion: "21st Birthday", themeSlugs: ["cultural-island"] }),
      candidate(4, { occasionSlug: "birthday", subOccasion: "18th Birthday", themeSlugs: ["colour-style"] }),
      candidate(5, { occasionSlug: "birthday", subOccasion: "21st Birthday", themeSlugs: ["cultural-island"] }),
    ];
    const service = createPublicGalleryService({
      repository: repository(rows),
      imageAvailable: async (storageKey) => !storageKey.endsWith("/2.jpg"),
    });

    const result = await service.list({
      page: 1,
      productTypes: ["canvas"],
      occasions: ["memorial", "birthday"],
      birthdayAges: ["21st Birthday"],
      themes: ["cultural-island"],
    });

    expect(result.total).toBe(1);
    expect(result.items.map((item) => item.altText)).toEqual(["Artwork 5"]);
  });

  it("returns deterministic 24-item pages and clamps past the last page", async () => {
    const rows = Array.from({ length: 25 }, (_, index) => candidate(index + 1));
    const service = createPublicGalleryService({
      repository: repository(rows),
      imageAvailable: async () => true,
    });

    const result = await service.list({
      page: 99,
      productTypes: [],
      occasions: [],
      birthdayAges: [],
      themes: [],
    });

    expect(result).toMatchObject({ page: 2, pageCount: 2, total: 25 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].altText).toBe("Artwork 1");
  });
});
