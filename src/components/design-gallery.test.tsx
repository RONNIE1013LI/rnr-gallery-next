import { fireEvent, render, screen, within } from "@testing-library/react";
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
  it("shows birthday ages immediately when Birthday is selected in the open filter form", () => {
    render(<DesignGallery
      query={{ ...query, occasions: [], birthdayAges: [], showFilters: true }}
      result={{ items: [], total: 0, page: 1, pageCount: 1, pageSize: 24 }}
    />);

    expect(screen.queryByRole("group", { name: "Birthday age" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Birthday" }));

    expect(screen.getByRole("group", { name: "Birthday age" })).toBeInTheDocument();
  });

  it("opens the full filters when requested from a browse-by-occasion link", () => {
    render(<DesignGallery
      query={{ ...query, birthdayAges: [], showFilters: true }}
      result={{ items: [], total: 0, page: 1, pageCount: 1, pageSize: 24 }}
    />);

    expect(screen.getByText("Filters +").closest("details")).toHaveAttribute("open");
  });

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
    expect(screen.getByRole("img", { name: "Golden 21st birthday canvas" }))
      .toHaveAttribute("fetchpriority", "high");
    const artworkLink = screen.getByRole("link", { name: /view design details/i });
    expect(artworkLink).toContainElement(
      screen.getByRole("img", { name: "Golden 21st birthday canvas" }),
    );
    expect(artworkLink)
      .toHaveAttribute(
        "href",
        `/designs/21st-birthday-aaaaaaaa?from=${encodeURIComponent("/design-gallery?design_type=canvas&occasion=birthday&birthday_age=21st+Birthday&page=1")}`,
      );
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

  it("marks wall banners as wide mobile artwork and exposes compact product labels", () => {
    render(<DesignGallery
      query={{ ...query, productTypes: [] }}
      result={{
        items: [
          {
            id: "c".repeat(64),
            productTypeSlug: "canvas",
            occasionSlug: "family-portrait",
            subOccasion: null,
            themeSlugs: [],
            altText: "Family canvas",
            productSlug: "digital-oil-painting-canvas",
            contentHash: "d".repeat(64),
            mimeType: "image/jpeg",
            width: 1200,
            height: 1600,
          },
          {
            id: "e".repeat(64),
            productTypeSlug: "wall-hanging-banners",
            occasionSlug: "birthday",
            subOccasion: "80th Birthday",
            themeSlugs: [],
            altText: "80th birthday wall banner",
            productSlug: "custom-themed-wall-banner",
            contentHash: "f".repeat(64),
            mimeType: "image/jpeg",
            width: 2000,
            height: 1000,
          },
        ],
        total: 2,
        page: 1,
        pageCount: 1,
        pageSize: 24,
      }}
    />);

    const canvasCard = screen.getByRole("img", { name: "Family canvas" }).closest("article");
    const wallBannerCard = screen.getByRole("img", { name: "80th birthday wall banner" }).closest("article");

    expect(canvasCard).toHaveAttribute("data-gallery-mobile-span", "compact");
    expect(wallBannerCard).toHaveAttribute("data-gallery-mobile-span", "wide");
    expect(within(canvasCard as HTMLElement).getByText("Canvas", { selector: "span" })).toBeInTheDocument();
    expect(within(wallBannerCard as HTMLElement).getByText("Wall banner", { selector: "span" })).toBeInTheDocument();
  });
});
