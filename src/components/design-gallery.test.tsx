import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GalleryQuery } from "@/domain/gallery/query";
import { DesignGallery } from "./design-gallery";

const query: GalleryQuery = {
  page: 1,
  productTypes: ["canvas"],
  occasions: ["birthday"],
  birthdayAges: ["21st Birthday"],
  themes: [],
};

describe("DesignGallery", () => {
  it("renders URL-backed accessible filters, natural artwork and pagination", () => {
    render(<DesignGallery
      query={query}
      result={{
        items: [{
          id: "a".repeat(64),
          productTypeSlug: "canvas",
          occasionSlug: "birthday",
          subOccasion: "21st Birthday",
          themeSlugs: [],
          altText: "Golden 21st birthday canvas",
          productSlug: "digital-oil-painting-canvas",
          contentHash: "b".repeat(64),
          mimeType: "image/jpeg",
          width: 1200,
          height: 1600,
        }],
        total: 25,
        page: 1,
        pageCount: 2,
        pageSize: 24,
      }}
    />);

    expect(screen.getByRole("heading", { name: "Designed around your story." })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Canvas" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Birthday" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "21st Birthday" })).toBeChecked();
    expect(screen.getByText("25 artworks")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Golden 21st birthday canvas" }))
      .toHaveAttribute("width", "1200");
    expect(screen.getByRole("link", { name: /view golden 21st birthday canvas/i }))
      .toHaveAttribute("href", `/products/digital-oil-painting-canvas?design=${"a".repeat(64)}`);
    expect(screen.getByRole("link", { name: "Next page" })).toHaveAttribute("href", expect.stringContaining("page=2"));
  });

  it("shows a clear reset action when no designs match", () => {
    render(<DesignGallery
      query={{ ...query, page: 1 }}
      result={{ items: [], total: 0, page: 1, pageCount: 1, pageSize: 24 }}
    />);

    expect(screen.getByText(/no designs match/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /browse all designs/i }))
      .toHaveAttribute("href", "/design-gallery");
  });
});
