import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AdminGalleryList, type AdminGalleryListItem } from "./admin-gallery-list";

const css = readFileSync("src/components/storefront.module.css", "utf8");
const activeDesign: AdminGalleryListItem = {
  id: "a".repeat(64),
  altText: "Active birthday banner",
  imageUrl: `/gallery-images/${"a".repeat(64)}`,
  productTypeSlug: "wall-hanging-banners",
  occasionSlug: "birthday",
  subOccasion: "21st Birthday",
  productSlug: "custom-themed-wall-banner",
  status: "active",
};
const trashedDesign: AdminGalleryListItem = {
  ...activeDesign,
  id: "b".repeat(64),
  altText: "Archived birthday banner",
  imageUrl: `/gallery-images/${"b".repeat(64)}`,
  status: "trashed",
};

describe("AdminGalleryList", () => {
  it("keeps mobile filters compact while exposing the live result count", () => {
    render(<AdminGalleryList designs={[activeDesign, trashedDesign]} />);

    const summary = screen.getByText("Search and filters").closest("summary");
    expect(summary).toBeInTheDocument();
    expect(summary).toHaveTextContent("2 shown");
    expect(css).toMatch(/@media \(min-width: 768px\)[\s\S]*?\.adminGalleryFilterDisclosure:not\(\[open\]\) > \.adminGalleryFilters[\s\S]*?display:\s*grid;/);
  });

  it("does not request active-only artwork for trashed designs and handles missing active artwork", () => {
    const { container } = render(<AdminGalleryList designs={[activeDesign, trashedDesign]} />);

    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(screen.getByRole("img", { name: "Archived birthday banner preview unavailable" })).toHaveTextContent("Trashed");

    fireEvent.error(container.querySelector("img")!);
    expect(screen.getByRole("img", { name: "Active birthday banner preview unavailable" })).toHaveTextContent("Preview unavailable");
  });

  it("uses compact mobile cards with a visible action footer", () => {
    const mobile = css.slice(css.indexOf("@media (max-width: 767px)"));
    expect(mobile).toMatch(/\.adminGalleryRow\s*\{[\s\S]*?border-radius:\s*12px;/);
    expect(mobile).toMatch(/\.adminGalleryFooter\s*\{[\s\S]*?border-top:\s*1px solid var\(--border\);/);
  });

  it("paginates large galleries without changing the active filters", () => {
    const designs = Array.from({ length: 25 }, (_, index) => ({
      ...activeDesign,
      id: index.toString(16).padStart(64, "0"),
      altText: `Gallery design ${index + 1}`,
      imageUrl: `/gallery-images/${index.toString(16).padStart(64, "0")}`,
    }));
    render(<AdminGalleryList designs={designs} />);

    expect(screen.getByText("Gallery design 24")).toBeInTheDocument();
    expect(screen.queryByText("Gallery design 25")).not.toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next gallery page" }));
    expect(screen.queryByText("Gallery design 1")).not.toBeInTheDocument();
    expect(screen.getByText("Gallery design 25")).toBeInTheDocument();
  });
});
