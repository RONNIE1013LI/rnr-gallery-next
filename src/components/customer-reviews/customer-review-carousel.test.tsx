import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CustomerReviewCarousel } from "./customer-review-carousel";
import { featuredReview, secondReview } from "./test-fixtures";

describe("CustomerReviewCarousel", () => {
  afterEach(() => vi.restoreAllMocks());

  it("supports buttons and Arrow keys without autoplay or cloned slides", () => {
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });
    render(<CustomerReviewCarousel reviews={[featuredReview, secondReview]} />);

    const previous = screen.getByRole("button", { name: "Previous recommendations" });
    const next = screen.getByRole("button", { name: "Next recommendations" });
    const carousel = screen.getByRole("region", { name: "Customer recommendations" });
    expect(previous).toBeDisabled();
    expect(next).toBeEnabled();
    expect(screen.getAllByRole("article")).toHaveLength(2);

    fireEvent.click(next);
    expect(scrollTo).toHaveBeenCalled();
    expect(next).toBeDisabled();
    fireEvent.keyDown(carousel, { key: "ArrowLeft" });
    expect(previous).toBeDisabled();
  });

  it("keeps controls in sync after direct touch or trackpad scrolling", () => {
    render(<CustomerReviewCarousel reviews={[featuredReview, secondReview]} />);

    const carousel = screen.getByRole("region", { name: "Customer recommendations" });
    const cards = screen.getAllByRole("article");
    Object.defineProperty(carousel, "scrollLeft", { configurable: true, value: 320 });
    Object.defineProperty(cards[0], "offsetLeft", { configurable: true, value: 0 });
    Object.defineProperty(cards[1], "offsetLeft", { configurable: true, value: 320 });

    fireEvent.scroll(carousel);

    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous recommendations" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next recommendations" })).toBeDisabled();
  });

  it("opens the full unchanged recommendation only when text overflows and restores focus", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(80);
    render(<CustomerReviewCarousel reviews={[featuredReview]} />);

    const trigger = await screen.findByRole("button", { name: "Read full recommendation from Aroha Te Rangi" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Recommendation from Aroha Te Rangi" });
    expect(dialog.querySelector("p:last-of-type")?.textContent).toBe(featuredReview.originalReviewText);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});
