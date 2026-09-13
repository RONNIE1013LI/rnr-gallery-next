import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GuestCheckoutLink } from "./guest-checkout-link";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

describe("guest checkout navigation", () => {
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
  it("announces loading and prevents a repeated navigation", () => {
    render(<GuestCheckoutLink />);
    fireEvent.click(screen.getByRole("link", { name: "Continue as Guest" }));
    expect(screen.getByRole("link", { name: "Opening checkout…" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("link", { name: "Opening checkout…" }));
    expect(navigation.push).toHaveBeenCalledTimes(1);
  });
  it("offers a customer-safe retry if the destination has not rendered", () => {
    vi.useFakeTimers();
    render(<GuestCheckoutLink />);
    fireEvent.click(screen.getByRole("link", { name: "Continue as Guest" }));
    act(() => vi.advanceTimersByTime(15000));
    expect(screen.getByRole("alert")).toHaveTextContent("Checkout is taking longer than expected. Please try again.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(navigation.push).toHaveBeenCalledTimes(2);
  });
});
