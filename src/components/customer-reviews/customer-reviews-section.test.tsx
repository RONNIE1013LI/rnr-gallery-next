import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PublicCustomerReviewSection } from "@/domain/customer-reviews/types";
import { CustomerReviewsSection } from "./customer-reviews-section";
import { featuredReview, secondReview } from "./test-fixtures";
import styles from "./customer-reviews.module.css";

const section: PublicCustomerReviewSection = {
  summary: {
    rating: 4.9,
    recommendationCount: 288,
    countIsApproximate: true,
    reviewsPageUrl: "https://www.facebook.com/RandRgallery/reviews/",
    lastVerifiedAt: "2026-08-20",
  },
  featured: featuredReview,
  reviews: [secondReview],
};

describe("CustomerReviewsSection", () => {
  it("renders the Facebook trust badge from the published summary and the Featured review exactly once", () => {
    render(<CustomerReviewsSection data={section} />);

    expect(screen.getByText("REAL CUSTOMER REVIEWS")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recommended by our customers." })).toBeInTheDocument();
    expect(screen.getByText("Selected public recommendations originally shared on our Facebook Page.")).toBeInTheDocument();
    expect(screen.getByText("EXCELLENT")).toBeInTheDocument();
    expect(screen.getByLabelText("4.9 out of 5").querySelectorAll("svg")).toHaveLength(5);
    expect(screen.getByText("100% Recommended (288 Reviews)")).toBeInTheDocument();
    expect(screen.getByText("facebook")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View all on Facebook" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "View all on Facebook" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getAllByText("Aroha Te Rangi")).toHaveLength(1);
    expect(screen.getByText("Mereana K.")).toBeInTheDocument();
  });

  it("uses the published recommendation count in the trust badge", () => {
    render(<CustomerReviewsSection data={{
      ...section,
      summary: section.summary ? {
        ...section.summary,
        recommendationCount: 315,
        countIsApproximate: false,
      } : null,
    }} />);

    expect(screen.getByText("100% Recommended (315 Reviews)")).toBeInTheDocument();
    expect(screen.queryByText("100% Recommended (288 Reviews)")).not.toBeInTheDocument();
  });

  it("uses initials rather than a synthetic image and preserves untrusted text as text", () => {
    const unsafe = {
      ...section,
      featured: {
        ...featuredReview,
        reviewerName: "Aroha Te Rangi",
        originalReviewText: "First line\n<script>window.bad=true</script>",
      },
      reviews: [],
    };
    const { container } = render(<CustomerReviewsSection data={unsafe} />);
    const featured = screen.getByRole("article", { name: "Featured recommendation from Aroha Te Rangi" });

    expect(within(featured).getByText("AT")).toBeInTheDocument();
    expect(within(featured).getByText(/<script>window\.bad=true<\/script>/)).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(featured.querySelector("img")).toBeNull();
    expect(screen.getByText("today").closest("time")).toHaveAttribute("datetime", "2026-08-20");
    expect(screen.getByText("today").closest("time")).toHaveAttribute("title", "20 August 2026");
    expect(screen.queryByText(/Trustindex|Like|Comment|Share/)).not.toBeInTheDocument();
    expect(container.querySelector('a[href="#"]')).toBeNull();
  });

  it.each([
    { label: "portrait", width: 900, height: 1_600 },
    { label: "landscape", width: 1_600, height: 900 },
  ])("keeps a $label featured image in normal document flow", ({ width, height }) => {
    render(<CustomerReviewsSection data={{
      ...section,
      featured: {
        ...featuredReview,
        featuredImage: {
          url: `/review-media/${featuredReview.id}/featured-image`,
          mimeType: "image/webp",
          width,
          height,
        },
      },
    }} />);

    const image = screen.getByRole("img", {
      name: "Digital Oil Painting Canvas shared with this customer recommendation",
    });
    expect(image).toHaveAttribute("width", String(width));
    expect(image).toHaveAttribute("height", String(height));
    expect(image).not.toHaveAttribute("data-nimg", "fill");
    expect(image).not.toHaveStyle({ position: "absolute" });
    expect(image.parentElement).toHaveClass(styles.featuredImage);
  });

  it("keeps the text-only featured variant to a single content column", () => {
    const { container } = render(<CustomerReviewsSection data={section} />);
    const layout = container.querySelector(`.${styles.featuredLayout}`);

    expect(layout).toHaveClass(styles.featuredWithoutImage);
    expect(layout?.children).toHaveLength(1);
    expect(layout?.querySelector("img")).toBeNull();
  });
});
