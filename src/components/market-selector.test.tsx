import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateFixedPackage } from "@/domain/pricing/calculate-fixed-package";
import type { Cart, CartItem } from "@/domain/cart/types";
import { subscribeToCart } from "@/domain/cart/browser-cart-events";
import { setActiveCustomerId } from "@/domain/cart/browser-cart-scope";
import { MarketSelector } from "./market-selector";

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

function item(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: "item-1",
    productKey: "custom-themed-canvas",
    productSlug: "custom-themed-canvas",
    productTitle: "Custom Themed Canvas",
    imageSrc: "/media/products/custom-themed-canvas.webp",
    sizeKey: "a3",
    sizeLabel: "A3",
    orientation: "landscape",
    peoplePets: 0,
    photoSubmissionMethod: "later",
    designText: "",
    notes: "",
    neededDate: "2026-08-28",
    urgentServiceConfirmed: false,
    deliveryPreference: "post",
    quantity: 1,
    price: calculateFixedPackage({ priceExGstCents: 20_000 }),
    uploadReferences: [],
    ...overrides,
  };
}

function seedCart(items: readonly CartItem[] = [item()], customerId: string | null = null) {
  const identity = customerId === null ? "guest" : `user:${encodeURIComponent(customerId)}`;
  const cart: Cart = { version: 1, items };
  localStorage.setItem(`rnr:commerce:v1:${identity}:cart`, JSON.stringify(cart));
  return cart;
}

function successResponse() {
  return new Response(JSON.stringify({ market: "AU", currency: "AUD" }), { status: 200 });
}

afterEach(() => {
  setActiveCustomerId(null);
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.body.style.overflow = "";
});

describe("MarketSelector", () => {
  it("marks explicit selector changes as persistent customer preferences", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      market: "AU",
      currency: "AUD",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<MarketSelector market="NZ" australiaEnabled pathname="/help" />);

    fireEvent.change(screen.getByRole("combobox", { name: "Country and currency" }), {
      target: { value: "AU" },
    });

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(push).not.toHaveBeenCalled();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      market: "AU",
      persistPreference: true,
    });
  });

  it("supports a context-specific accessible label", () => {
    render(
      <MarketSelector
        market="NZ"
        australiaEnabled
        pathname="/"
        ariaLabel="Country and currency in mobile navigation"
      />,
    );

    expect(screen.getByRole("combobox", {
      name: "Country and currency in mobile navigation",
    })).toHaveValue("NZ");
  });

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
    expect(push).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("discards an in-flight success when the active commerce identity changes", async () => {
    setActiveCustomerId("user-a");
    const originalUserCart = seedCart([item()], "user-a");
    const originalGuestCart = seedCart([
      item({ id: "guest-item", productTitle: "Guest Canvas" }),
    ]);
    localStorage.setItem("rnr:commerce:v1:user:user-a:checkout:pending", "user-a-pending");
    localStorage.setItem("rnr:commerce:v1:guest:checkout:pending", "guest-pending");
    sessionStorage.setItem("rnr:commerce:v1:user:user-a:checkout:payment-intent", "user-a-payment");
    sessionStorage.setItem("rnr:commerce:v1:guest:checkout:payment-intent", "guest-payment");
    const cartChanged = vi.fn();
    const unsubscribe = subscribeToCart(cartChanged);
    const marketChanged = vi.fn();
    window.addEventListener("rnr:market-changed", marketChanged);
    let resolveSwitch!: (response: Response) => void;
    const pendingSwitch = new Promise<Response>((resolve) => { resolveSwitch = resolve; });
    const fetchMock = vi.fn().mockReturnValue(pendingSwitch);
    vi.stubGlobal("fetch", fetchMock);
    render(<MarketSelector market="NZ" australiaEnabled pathname="/" />);

    fireEvent.change(screen.getByRole("combobox", { name: "Country and currency" }), {
      target: { value: "AU" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Change browsing country" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    setActiveCustomerId(null);
    resolveSwitch(successResponse());

    await waitFor(() => expect(screen.getByRole("combobox", {
      name: "Country and currency",
    })).not.toBeDisabled());
    const cartChangedCalls = cartChanged.mock.calls.length;
    const marketChangedCalls = marketChanged.mock.calls.length;
    unsubscribe();
    window.removeEventListener("rnr:market-changed", marketChanged);

    expect(localStorage.getItem("rnr:commerce:v1:user:user-a:cart"))
      .toBe(JSON.stringify(originalUserCart));
    expect(localStorage.getItem("rnr:commerce:v1:guest:cart"))
      .toBe(JSON.stringify(originalGuestCart));
    expect(localStorage.getItem("rnr:commerce:v1:user:user-a:checkout:pending"))
      .toBe("user-a-pending");
    expect(localStorage.getItem("rnr:commerce:v1:guest:checkout:pending"))
      .toBe("guest-pending");
    expect(sessionStorage.getItem("rnr:commerce:v1:user:user-a:checkout:payment-intent"))
      .toBe("user-a-payment");
    expect(sessionStorage.getItem("rnr:commerce:v1:guest:checkout:payment-intent"))
      .toBe("guest-payment");
    expect(cartChangedCalls).toBe(0);
    expect(marketChangedCalls).toBe(0);
    expect(push).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each([false, true])("changes only browsing preference, preserving configured rush and price (%s)", async (rush) => {
    const original = seedCart([item({ urgentServiceConfirmed: rush, urgentFeeInclGstCents: rush ? 10000 : 0, productionWorkingDays: rush ? 2 : 10, eventDate: "2020-01-01", galleryDesignId: "a".repeat(64) })]);
    const fetchMock = vi.fn().mockResolvedValue(successResponse());
    vi.stubGlobal("fetch", fetchMock);
    render(<MarketSelector market="NZ" australiaEnabled pathname="/checkout/start" />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "AU" } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Keep your configured cart" })).toBeVisible();
    expect(document.querySelector('input[type="date"]')).toBeNull();
    expect(screen.queryByRole("button", { name: /urgent|rush/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit configuration for Custom Themed Canvas" })).toHaveAttribute("href", `/au/products/custom-themed-canvas/configure?edit=item-1&size=a3&design=${"a".repeat(64)}`);
    fireEvent.click(screen.getByRole("button", { name: "Change browsing country" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ market: "AU", persistPreference: true });
    expect(localStorage.getItem("rnr:commerce:v1:guest:cart")).toBe(JSON.stringify(original));
  });

  it("cancels with Escape without requests or cart changes and restores focus", () => {
    const original = seedCart();
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    render(<MarketSelector market="NZ" australiaEnabled pathname="/" />);
    const select = screen.getByRole("combobox"); select.focus();
    fireEvent.change(select, { target: { value: "AU" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(select).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("rnr:commerce:v1:guest:cart")).toBe(JSON.stringify(original));
  });

  it("keeps the cart and permits retry after a failed preference request", async () => {
    const original = seedCart();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(successResponse()));
    render(<MarketSelector market="NZ" australiaEnabled pathname="/" />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "AU" } });
    fireEvent.click(screen.getByRole("button", { name: "Change browsing country" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The market could not be changed.");
    expect(localStorage.getItem("rnr:commerce:v1:guest:cart")).toBe(JSON.stringify(original));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "AU" } });
    fireEvent.click(screen.getByRole("button", { name: "Change browsing country" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/au"));
  });

  it("does not confirm a stale dialog after the active customer changes", () => {
    setActiveCustomerId("user-a");
    const original = seedCart([item()], "user-a");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    render(<MarketSelector market="NZ" australiaEnabled pathname="/" />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "AU" } });
    setActiveCustomerId(null);
    fireEvent.click(screen.getByRole("button", { name: "Change browsing country" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(localStorage.getItem("rnr:commerce:v1:user:user-a:cart")).toBe(JSON.stringify(original));
  });

  it("prevents repeat confirmation while the preference request is pending", async () => {
    seedCart();
    let resolve!: (response: Response) => void;
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((r) => { resolve = r; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<MarketSelector market="NZ" australiaEnabled pathname="/" />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "AU" } });
    const button = screen.getByRole("button", { name: "Change browsing country" });
    fireEvent.click(button); fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    resolve(successResponse());
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  });
});
