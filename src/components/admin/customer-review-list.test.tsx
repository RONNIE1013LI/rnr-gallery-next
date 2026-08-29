import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AdminCustomerReview } from "@/domain/customer-reviews/types";
import { CustomerReviewList } from "./customer-review-list";

const review: AdminCustomerReview = {
  id: "11111111-1111-4111-8111-111111111111",
  sourcePlatform: "FACEBOOK",
  status: "PUBLISHED",
  reviewerName: "Aroha T.",
  originalReviewText: "The finished canvas was beautiful.",
  sourceReviewUrl: "https://www.facebook.com/example/reviews",
  reviewDate: "2026-08-01",
  recommendationStatus: "RECOMMENDS",
  editorialHeadline: "A meaningful family canvas",
  productKey: "digital-oil-painting-canvas",
  productDisplayLabel: "Digital Oil Painting Canvas",
  orderContext: "Memorial canvas",
  isHomepageFeatured: true,
  displayOrder: 10,
  permissionStatus: "GRANTED",
  permissionEvidenceReference: "private evidence reference",
  permissionNotes: "private permission note",
  lastVerifiedAt: "2026-08-19T00:00:00.000Z",
  publishedAt: new Date("2026-08-19T00:00:00.000Z"),
  archivedAt: null,
  createdAt: new Date("2026-08-18T00:00:00.000Z"),
  updatedAt: new Date("2026-08-19T00:00:00.000Z"),
  media: [],
};

describe("CustomerReviewList", () => {
  it("shows operational review fields without exposing permission evidence or notes", () => {
    render(<CustomerReviewList reviews={[review]} />);

    expect(screen.getByText("Aroha T.")).toBeInTheDocument();
    expect(screen.getAllByText("Published")).toHaveLength(2);
    expect(screen.getAllByText("Granted")).toHaveLength(2);
    expect(screen.getByText("Homepage featured")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit Aroha T." })).toHaveAttribute(
      "href",
      `/admin/customer-reviews/${review.id}`,
    );
    expect(screen.queryByText("private evidence reference")).not.toBeInTheDocument();
    expect(screen.queryByText("private permission note")).not.toBeInTheDocument();
  });

  it("shows the selected review source", () => {
    render(<CustomerReviewList reviews={[{ ...review, sourcePlatform: "GOOGLE" }]} />);

    expect(screen.getByText("Google")).toBeInTheDocument();
  });

  it("renders an empty state with a creation action", () => {
    render(<CustomerReviewList reviews={[]} />);

    expect(screen.getByRole("heading", { name: "No customer reviews yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add the first review" })).toHaveAttribute(
      "href",
      "/admin/customer-reviews/new",
    );
  });
});
