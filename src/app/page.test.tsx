import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import styles from "@/components/storefront.module.css";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import { HomeContent } from "./home-content";

describe("Home", () => {
  it("renders published managed hero text when supplied", () => {
    render(<HomeContent content={{
      eyebrow: "Made in the studio",
      title: "Your story, made tangible.",
      subtitle: "A managed homepage introduction.",
      primaryCta: "Start creating",
      secondaryCta: "See real work",
    }} />);

    expect(screen.getByText("Made in the studio")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your story, made tangible." })).toBeInTheDocument();
    expect(screen.getByText("A managed homepage introduction.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start creating" })).toHaveAttribute("href", "/shop");
    expect(screen.getByRole("link", { name: "See real work" })).toHaveAttribute("href", "/design-gallery");
  });

  it("presents the digital oil painting canvas as the homepage hero", () => {
    const { container } = render(<HomeContent />);

    expect(container.querySelector("main")).toHaveClass(styles.homePage);

    const heroImage = screen.getByRole("img", {
      name: "Digital oil painting canvas displayed in a warm home interior",
    });
    expect(heroImage).toHaveAttribute(
      "src",
      expect.stringContaining("digital-oil-painting-canvas-hero-landscape-01.webp"),
    );
    expect(screen.getByRole("link", { name: "Create your artwork" })).toHaveAttribute(
      "href",
      "/shop",
    );
    expect(container.querySelector("#rnr-local-business")).toHaveAttribute(
      "type",
      "application/ld+json",
    );
  });

  it("keeps the original product-story copy on the homepage", () => {
    render(<HomeContent />);

    expect(
      screen.getByRole("heading", { name: "Digital oil painting canvas" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "A painterly artwork created from your photo and printed on premium canvas.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Roll-up banner" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "A personalised roll-up display for memorial services, celebrations and promotional events.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Wall banner" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Custom wall banners for memorials, celebrations and meaningful occasions.",
      ),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("region", { name: "Digital oil painting canvas details" }),
      ).queryByText(/^From \$/),
    ).not.toBeInTheDocument();
  });

  it("does not render products that an administrator has unpublished", () => {
    const registry = structuredClone(defaultProductRegistry);
    const rollUp = registry.products.find((product) => product.slug === "roll-up-banner");
    if (!rollUp) throw new Error("Missing roll-up banner fixture");
    rollUp.active = false;
    rollUp.featured = false;

    render(<HomeContent registry={registry} />);

    expect(
      screen.queryByRole("region", { name: "Roll-Up Banner details" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Roll-up banner" }),
    ).not.toBeInTheDocument();
  });

  it("shows reviewed Facebook recommendations on the homepage", () => {
    render(<HomeContent />);

    const reviews = screen.getByRole("region", {
      name: "Facebook recommendations",
    });
    expect(
      within(reviews).getByRole("link", {
        name: "View Facebook recommendations",
      }),
    ).toHaveAttribute(
      "href",
      "https://www.facebook.com/RandRgallery/reviews/?id=100063872118160&sk=reviews",
    );
    expect(within(reviews).getByText("100% Recommended")).toBeInTheDocument();
    expect(within(reviews).getByText("284 Facebook reviews")).toBeInTheDocument();
    expect(within(reviews).getAllByRole("listitem")).toHaveLength(3);

    expect(
      within(reviews).getByRole("link", { name: "Next recommendations" }),
    ).toHaveAttribute("href", "/?reviews=2#facebook-recommendations");

    render(<HomeContent reviewPage={2} />);
    expect(screen.getByText("Ari George")).toBeInTheDocument();
  });
});
