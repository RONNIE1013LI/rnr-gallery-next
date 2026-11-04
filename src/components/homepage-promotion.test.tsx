import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomepagePromotion } from "./homepage-promotion";

const storageKey = "rnr:homepage-promotion:36-percent:v1";
const now = new Date("2026-11-02T10:00:00Z");
const openPromotion = async () => act(async () => vi.advanceTimersByTimeAsync(4_000));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enabled: true }) }));
  vi.useFakeTimers();
  vi.setSystemTime(now);
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("HomepagePromotion", () => {
  it("waits four seconds before showing the correct offer and existing destinations", async () => {
    render(<HomepagePromotion />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(3_999));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByRole("dialog", { name: "Limited-time offer: save 36% in total" })).toBeInTheDocument();
    expect(screen.getByText(/extra 20% off the discounted price/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/account/register?next=%2Fshop");
    expect(screen.getByRole("link", { name: "Message our team" })).toHaveAttribute("href", "https://m.me/RandRgallery");
    expect(screen.getByText("NO CODE NEEDED")).toBeVisible();
    expect(screen.getByText("EVERY ORDER: 20% OFF")).toBeVisible();
    expect(screen.getByText("Your 20% discount is automatically applied in your cart on every order during the promotion.")).toBeVisible();
    expect(screen.getByText(/claim your account-bound voucher.*Each voucher can be used once/)).toBeVisible();
  });

  it("uses mobile artwork without cropping and keeps the AU signup destination", async () => {
    render(<HomepagePromotion market="AU" />);
    await openPromotion();
    const picture = screen.getByAltText("R&R Gallery limited-time canvas and banner offer").closest("picture");
    expect(picture?.querySelector("source")).toHaveAttribute("media", "(max-width: 640px)");
    expect(picture?.querySelector("source")).toHaveAttribute("srcset", "/media/promotions/thank-you-36-mobile.webp");
    expect(screen.getByRole("link", { name: "Sign up" }).closest("[data-artwork-actions]")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Message our team" }).closest("[data-artwork-actions]")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/account/register?next=%2Fau%2Fshop");
  });

  it("shows again after closing and refreshing even if a previous daily-cap timestamp exists", async () => {
    localStorage.setItem(storageKey, String(Date.now()));
    const { unmount } = render(<HomepagePromotion />);
    await openPromotion();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close promotion" }));
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    unmount();
    render(<HomepagePromotion />);
    await openPromotion();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("still shows when browser storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
    render(<HomepagePromotion />);
    await openPromotion();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("contains focus, closes on Escape and restores the previous focus and scrolling", async () => {
    render(<><button>Previous focus</button><HomepagePromotion /></>);
    const previous = screen.getByRole("button", { name: "Previous focus" });
    previous.focus();
    await openPromotion();
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

  it("closes only on the backdrop, not when clicking the artwork", async () => {
    render(<HomepagePromotion />);
    await openPromotion();
    fireEvent.click(screen.getByAltText("R&R Gallery limited-time canvas and banner offer"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("promotion-backdrop"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not interrupt an existing dialog or cookie preferences", async () => {
    render(<><section role="dialog" aria-label="Cart review" /><HomepagePromotion /></>);
    await openPromotion();
    expect(screen.queryByRole("dialog", { name: /Limited-time/ })).not.toBeInTheDocument();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it("cancels delayed display when leaving the homepage", async () => {
    const { unmount } = render(<HomepagePromotion />);
    unmount();
    await openPromotion();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });
  it.each([false, null])("does not display when the persisted switch is %s or unavailable", async (enabled) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enabled }) }));
    render(<HomepagePromotion />);
    await openPromotion();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("fails closed when the switch request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unavailable")));
    render(<HomepagePromotion />);
    await openPromotion();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

});
