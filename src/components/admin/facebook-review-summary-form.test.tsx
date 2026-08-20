import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FacebookReviewSummaryForm } from "./facebook-review-summary-form";

describe("FacebookReviewSummaryForm", () => {
  it("allows draft saves but only shows publish to a publisher", () => {
    const { rerender } = render(
      <FacebookReviewSummaryForm canPublish={false} settings={{ draft: null, published: null }} />,
    );
    expect(screen.getByRole("button", { name: "Save summary draft" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish summary" })).not.toBeInTheDocument();

    rerender(<FacebookReviewSummaryForm canPublish settings={{ draft: null, published: null }} />);
    expect(screen.getByRole("button", { name: "Publish summary" })).toBeInTheDocument();
    expect(screen.getByLabelText("Published Facebook summary")).toHaveTextContent("Not published");
  });

  it("sends only the configured aggregate Facebook summary", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ settings: { draft: {}, published: null } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    render(<FacebookReviewSummaryForm canPublish settings={{ draft: null, published: null }} />);

    fireEvent.change(screen.getByLabelText("Facebook rating"), { target: { value: "4.9" } });
    fireEvent.change(screen.getByLabelText("Recommendation count"), { target: { value: "280" } });
    fireEvent.change(screen.getByLabelText("Facebook reviews page URL"), {
      target: { value: "https://www.facebook.com/rrgallery/reviews" },
    });
    fireEvent.change(screen.getByLabelText("Last verified date"), { target: { value: "2026-08-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save summary draft" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const request = fetchMock.mock.calls[0][1];
    expect(request?.method).toBe("PATCH");
    expect(JSON.parse(String(request?.body))).toEqual({
      action: "save_draft",
      facebookRating: "4.9",
      facebookRecommendationCount: "280",
      facebookCountIsApproximate: false,
      facebookReviewsPageUrl: "https://www.facebook.com/rrgallery/reviews",
      facebookLastVerifiedAt: "2026-08-20",
    });
  });
});
