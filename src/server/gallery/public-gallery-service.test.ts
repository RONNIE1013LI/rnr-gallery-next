import { describe, expect, it, vi } from "vitest";
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
    listActivePage: async () => ({ items: [], total: 0, page: 1, pageCount: 1 }),
    findActiveImage: async () => null,
    findActiveDesign: async (designId) => rows.find((row) => row.id === designId) ?? null,
    findActiveDesignByIdPrefix: async (prefix) => {
      const matches = rows.filter((row) => row.id.startsWith(prefix));
      return matches.length === 1 ? matches[0] : null;
    },
  };
}

describe("public gallery service", () => {
  it("returns requested curated designs in the requested order and skips unavailable images", async () => {
    const first = candidate(1);
    const second = candidate(2);
    const findActiveDesign = vi.fn(async (designId: string) =>
      [first, second].find((row) => row.id === designId) ?? null
    );
    const service = createPublicGalleryService({
      repository: {
        ...repository([]),
        findActiveDesign,
      },
      imageAvailable: async (storageKey) => !storageKey.endsWith("/1.jpg"),
    });

    const result = await service.findByIds([second.id, first.id, "f".repeat(64)]);

    expect(result.map((item) => item.id)).toEqual([second.id]);
    expect(findActiveDesign).toHaveBeenCalledTimes(3);
  });

  it("resolves an active design by the frozen URL ID prefix", async () => {
    const design = candidate(12, {
      id: `a1b2c3d4${"a".repeat(56)}`,
      subOccasion: "40th Birthday",
    });
    const service = createPublicGalleryService({
      repository: repository([design]),
      imageAvailable: async () => true,
    });

    await expect(service.findByPublicSlug("any-readable-title-a1b2c3d4"))
      .resolves.toMatchObject({
        id: design.id,
        subOccasion: "40th-birthday",
        publicSlug: "40th-birthday-a1b2c3d4",
      });
  });

  it("normalises legacy religious rows into the public Church / Religious occasion", async () => {
    const design = candidate(13, { occasionSlug: "religious" });
    const service = createPublicGalleryService({
      repository: repository([design]),
      imageAvailable: async () => true,
    });

    const result = await service.list({
      page: 1,
      productTypes: [],
      occasions: ["religious-church"],
      birthdayAges: [],
      themes: [],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].occasionSlug).toBe("religious-church");
  });

  it("filters the public overlay taxonomy in memory instead of relying on persisted SQL categories", async () => {
    const birthday = candidate(21, {
      occasionSlug: "birthday",
      subOccasion: "21st Birthday",
      themeSlugs: ["cultural-island"],
    });
    const memorial = candidate(22, {
      occasionSlug: "memorial",
      themeSlugs: ["cultural-island"],
    });
    const listActiveCandidates = vi.fn(async () => [birthday, memorial]);
    const listActivePage = vi.fn(async () => {
      throw new Error("public filtering must not use persisted SQL taxonomy");
    });
    const service = createPublicGalleryService({
      repository: {
        ...repository([]),
        listActiveCandidates,
        listActivePage,
      },
      imageAvailable: async () => true,
    });

    const result = await service.list({
      page: 1,
      productTypes: ["canvas"],
      occasions: ["birthday"],
      birthdayAges: ["21st-birthday"],
      themes: ["cultural-island"],
    });

    expect(result.items.map((item) => item.id)).toEqual([birthday.id]);
    expect(listActiveCandidates).toHaveBeenCalledTimes(1);
    expect(listActivePage).not.toHaveBeenCalled();
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
    expect(result.items[0].id).toBe(rows[24].id);
  });

  it("ranks related designs by product, occasion and sub-occasion", async () => {
    const current = candidate(1, {
      productTypeSlug: "roll-up-banner",
      productSlug: "roll-up-banner",
      occasionSlug: "birthday",
      subOccasion: "21st Birthday",
    });
    const sameMilestone = candidate(2, {
      productTypeSlug: "roll-up-banner",
      productSlug: "roll-up-banner",
      occasionSlug: "birthday",
      subOccasion: "21st Birthday",
    });
    const sameOccasionDifferentProduct = candidate(3, {
      occasionSlug: "birthday",
      subOccasion: "21st Birthday",
    });
    const unrelated = candidate(4, {
      occasionSlug: "memorial",
    });
    const service = createPublicGalleryService({
      repository: repository([current, unrelated, sameOccasionDifferentProduct, sameMilestone]),
      imageAvailable: async () => true,
    });

    const related = await service.listRelated(current.id, 3);

    expect(related[0].id).toBe(sameMilestone.id);
    expect(related.map((item) => item.id)).not.toContain(current.id);
  });
});
