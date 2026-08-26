import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

  it("uses fixed 180px media thumbnails with density candidates", async () => {
    const { container } = render(await AdminMediaPage());

    const images = [...container.querySelectorAll("img")];
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image).toHaveAttribute("width", "180");
      expect(image).toHaveAttribute("height", "135");
      expect(image).not.toHaveAttribute("sizes");
    }
  });
});
