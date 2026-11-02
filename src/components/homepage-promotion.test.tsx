import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomepagePromotion } from "./homepage-promotion";

const storageKey = "rnr:homepage-promotion:36-percent:v1";
const now = new Date("2026-11-02T10:00:00Z");
const openPromotion = () => act(() => vi.advanceTimersByTime(4_000));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("HomepagePromotion", () => {
  it("waits four seconds before showing the correct offer and existing destinations", () => {
    render(<HomepagePromotion />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3_999));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("dialog", { name: "Limited-time offer: save 36% in total" })).toBeInTheDocument();
    expect(screen.getByText(/extra 20% off the discounted price/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/account/register?next=%2Fshop");
    expect(screen.getByRole("link", { name: "Message our team" })).toHaveAttribute("href", "https://m.me/RandRgallery");
    expect(screen.getByText(/applies automatically when signed in/)).toBeInTheDocument();
  });

  it("uses mobile artwork without cropping and keeps the AU signup destination", () => {
    render(<HomepagePromotion market="AU" />);
    openPromotion();
    const picture = screen.getByAltText("R&R Gallery limited-time canvas and banner offer").closest("picture");
    expect(picture?.querySelector("source")).toHaveAttribute("media", "(max-width: 640px)");
    expect(picture?.querySelector("source")).toHaveAttribute("srcset", "/media/promotions/thank-you-36-mobile.webp");
    expect(screen.getByRole("link", { name: "Sign up" }).closest("[data-artwork-actions]")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Message our team" }).closest("[data-artwork-actions]")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/account/register?next=%2Fau%2Fshop");
  });

  it("shows again after closing and refreshing even if a previous daily-cap timestamp exists", () => {
    localStorage.setItem(storageKey, String(Date.now()));
    const { unmount } = render(<HomepagePromotion />);
    openPromotion();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close promotion" }));
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    unmount();
    render(<HomepagePromotion />);
    openPromotion();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("still shows when browser storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
    render(<HomepagePromotion />);
    openPromotion();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("contains focus, closes on Escape and restores the previous focus and scrolling", () => {
    render(<><button>Previous focus</button><HomepagePromotion /></>);
    const previous = screen.getByRole("button", { name: "Previous focus" });
    previous.focus();
    openPromotion();
    const close = screen.getByRole("button", { name: "Close promotion" });
    const last = screen.getByRole("link", { name: "Message our team" });
    expect(close).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    expect(previous.closest("[aria-hidden='true']")).not.toBeNull();
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
    expect(previous).toHaveFocus();
  });

  it("closes only on the backdrop, not when clicking the artwork", () => {
    render(<HomepagePromotion />);
    openPromotion();
    fireEvent.click(screen.getByAltText("R&R Gallery limited-time canvas and banner offer"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("promotion-backdrop"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not interrupt an existing dialog or cookie preferences", () => {
    render(<><section role="dialog" aria-label="Cart review" /><HomepagePromotion /></>);
    openPromotion();
    expect(screen.queryByRole("dialog", { name: /Limited-time/ })).not.toBeInTheDocument();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it("cancels delayed display when leaving the homepage", () => {
    const { unmount } = render(<HomepagePromotion />);
    unmount();
    openPromotion();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });
});
