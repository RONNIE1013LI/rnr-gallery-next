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
    listActivePage: async (query, pageSize) => {
      const filtered = rows.filter((row) =>
        (query.productTypes.length === 0 || query.productTypes.includes(row.productTypeSlug)) &&
        (query.occasions.length === 0 || query.occasions.includes(row.occasionSlug)) &&
        (query.birthdayAges.length === 0 || (
          row.subOccasion !== null && query.birthdayAges.includes(row.subOccasion)
        )) &&
        (query.themes.length === 0 || row.themeSlugs.some((theme) => query.themes.includes(theme))),
      ).sort((left, right) =>
        right.createdAt.getTime() - left.createdAt.getTime() || left.id.localeCompare(right.id),
      );
      const total = filtered.length;
      const pageCount = Math.max(1, Math.ceil(total / pageSize));
      const page = Math.min(query.page, pageCount);
      return {
        items: filtered.slice((page - 1) * pageSize, page * pageSize),
        total,
        page,
        pageCount,
      };
    },
    findActiveImage: async () => null,
    findActiveDesign: async () => null,
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

  it("allows the homepage to request one available design per category", async () => {
    const query = {
      page: 1,
      productTypes: [],
      occasions: ["birthday" as const],
      birthdayAges: [],
      themes: [],
    };
    const listActivePage = vi.fn().mockResolvedValue({
      items: [candidate(1, { occasionSlug: "birthday" })],
      total: 8,
      page: 1,
      pageCount: 8,
    });
    const service = createPublicGalleryService({
      repository: {
        ...repository([]),
        listActivePage,
      },
      imageAvailable: async () => true,
    });

    const result = await service.list(query, 1);

    expect(listActivePage).toHaveBeenCalledWith(query, 1);
    expect(result.pageSize).toBe(1);
    expect(result.items).toHaveLength(1);
  });

  it("requests only one filtered page from storage instead of scanning every design", async () => {
    const query = {
      page: 2,
      productTypes: ["canvas" as const],
      occasions: ["birthday" as const],
      birthdayAges: ["21st Birthday"],
      themes: ["cultural-island" as const],
    };
    const listActivePage = vi.fn().mockResolvedValue({
      items: [candidate(25)],
      total: 25,
      page: 2,
      pageCount: 2,
    });
    const imageAvailable = vi.fn().mockResolvedValue(true);
    const service = createPublicGalleryService({
      repository: {
        ...repository([]),
        listActiveCandidates: vi.fn().mockRejectedValue(new Error("full scan")),
        listActivePage,
      } as GalleryRepository,
      imageAvailable,
    });

    await expect(service.list(query)).resolves.toMatchObject({
      total: 25,
      page: 2,
      pageCount: 2,
      items: [expect.objectContaining({ altText: "Artwork 25" })],
    });
    expect(listActivePage).toHaveBeenCalledWith(query, 24);
    expect(imageAvailable).toHaveBeenCalledTimes(1);
  });

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
