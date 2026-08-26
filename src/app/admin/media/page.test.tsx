import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  declaredImageWidth,
  generatedSrcsetDescriptors,
  productionCandidateFor,
} from "@/test/image-candidate-assertions";
import AdminMediaPage from "./page";

const { requireAdminPage, listAdminMedia } = vi.hoisted(() => ({
  requireAdminPage: vi.fn(),
  listAdminMedia: vi.fn(),
}));

vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/server/admin/admin-media-service", () => ({ listAdminMedia }));

describe("admin media page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminPage.mockResolvedValue({ user: { id: "admin-1" } });
    listAdminMedia.mockResolvedValue({
      storefront: [{
        name: "canvas.webp",
        url: "/media/products/canvas.webp",
        sizeBytes: 12_000,
        usedBy: ["Canvas"],
      }],
      gallery: [{
        id: "a".repeat(64),
        imageUrl: `/gallery-images/${"a".repeat(64)}`,
        altText: "Birthday canvas",
        status: "published",
        productTypeSlug: "canvas",
      }],
      missingProductMedia: [],
    });
  });

  it("serves a retina candidate for the measured single-column mobile thumbnail", async () => {
    const { container } = render(await AdminMediaPage());

    const images = [...container.querySelectorAll("img")];
    expect(images).toHaveLength(2);
    const viewportCases = [
      { viewport: 375, width: 301, candidate: 640 },
      { viewport: 390, width: 151, candidate: 320 },
      { viewport: 768, width: 159.48, candidate: 320 },
      { viewport: 900, width: 190.5, candidate: 384 },
      { viewport: 1180, width: 153.44, candidate: 320 },
      { viewport: 1440, width: 166.27, candidate: 384 },
      { viewport: 1920, width: 159, candidate: 320 },
    ] as const;

    for (const image of images) {
      for (const { viewport, width, candidate } of viewportCases) {
        expect(declaredImageWidth(image, viewport)).toBeCloseTo(width, 1);
        expect(productionCandidateFor(image, viewport)).toBe(candidate);
      }
      expect(generatedSrcsetDescriptors(image)).toContain("640w");
      expect(generatedSrcsetDescriptors(image)).not.toContain("2x");
    }
  });
});
