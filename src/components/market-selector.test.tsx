import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setActiveCustomerId } from "@/domain/cart/browser-cart-scope";
import { MarketSelector } from "./market-selector";

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

afterEach(() => {
  setActiveCustomerId(null);
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("MarketSelector", () => {
  it("uses country-only labels on mobile without changing the selected market", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    render(<MarketSelector market="NZ" australiaEnabled pathname="/" />);

    expect(screen.getByRole("combobox", { name: "Country and currency" })).toHaveValue("NZ");
    expect(screen.getByRole("option", { name: "New Zealand" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Australia" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "New Zealand — NZD" })).not.toBeInTheDocument();
    expect(document.querySelector(".site-header__market-icon")).toBeInTheDocument();
  });

  it("clears only the active identity checkout state after a successful market change", async () => {
    setActiveCustomerId("user-a");
    localStorage.setItem("rnr:commerce:v1:user:user-a:cart", "user-a-cart");
    localStorage.setItem("rnr:commerce:v1:user:user-a:checkout:pending", "pending");
    localStorage.setItem("rnr:commerce:v1:user:user-b:checkout:pending", "user-b-pending");
    sessionStorage.setItem("rnr:commerce:v1:user:user-a:checkout:payment-intent", "payment");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    render(<MarketSelector market="NZ" australiaEnabled pathname="/products/roll-up-banner" />);

    fireEvent.change(screen.getByRole("combobox", { name: "Country and currency" }), {
      target: { value: "AU" },
    });

    await waitFor(() => expect(push).toHaveBeenCalledWith("/au/products/roll-up-banner"));
    expect(localStorage.getItem("rnr:commerce:v1:user:user-a:cart")).toBe("user-a-cart");
    expect(localStorage.getItem("rnr:commerce:v1:user:user-a:checkout:pending")).toBeNull();
    expect(sessionStorage.getItem("rnr:commerce:v1:user:user-a:checkout:payment-intent")).toBeNull();
    expect(localStorage.getItem("rnr:commerce:v1:user:user-b:checkout:pending")).toBe("user-b-pending");
  });
});
