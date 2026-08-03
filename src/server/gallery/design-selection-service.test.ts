import { describe, expect, it } from "vitest";
import { createDesignSelectionService } from "./design-selection-service";

const designId = "a".repeat(64);
const row = {
  id: designId,
  productTypeSlug: "canvas" as const,
  occasionSlug: "memorial" as const,
  subOccasion: "In loving memory",
  themeSlugs: ["religious-memorial" as const],
  altText: "Memorial canvas with floral border",
  productSlug: "digital-oil-painting-canvas" as const,
  storageKey: `generations/${"b".repeat(64)}/${designId}-cccccccccccc.jpg`,
  contentHash: "c".repeat(64),
  mimeType: "image/jpeg" as const,
  width: 1200,
  height: 1600,
  createdAt: new Date("2026-08-03T00:00:00Z"),
};

describe("design selection service", () => {
  it("returns a safe display selection only for the matching active product", async () => {
    const service = createDesignSelectionService({
      findActiveDesign: async (id) => id === designId ? row : null,
      imageAvailable: async () => true,
    });

    await expect(service.resolve(designId, "digital-oil-painting-canvas"))
      .resolves.toEqual({
        id: designId,
        title: "In loving memory",
        altText: "Memorial canvas with floral border",
        imageUrl: `/gallery-images/${designId}?v=${"c".repeat(64)}`,
        contentHash: "c".repeat(64),
        productSlug: "digital-oil-painting-canvas",
        width: 1200,
        height: 1600,
      });
    await expect(service.resolve(designId, "custom-themed-canvas"))
      .resolves.toBeNull();
    await expect(service.resolve("../secret", "digital-oil-painting-canvas"))
      .resolves.toBeNull();
  });

  it("rejects missing image files without exposing storage details", async () => {
    const service = createDesignSelectionService({
      findActiveDesign: async () => row,
      imageAvailable: async () => false,
    });
    await expect(service.resolve(designId, "digital-oil-painting-canvas"))
      .resolves.toBeNull();
  });
});
