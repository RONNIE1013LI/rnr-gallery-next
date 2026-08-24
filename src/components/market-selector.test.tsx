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

function issue(overrides: Record<string, unknown> = {}) {
  return {
    clientItemId: "item-1",
    productTitle: "Custom Themed Canvas",
    neededDate: "2026-08-28",
    urgentWorkingDays: 5,
    urgentFeeInclGstCents: 10_000,
    currency: "AUD",
    ...overrides,
  };
}

function urgentResponse(issues = [issue()]) {
  return new Response(JSON.stringify({
    error: "Confirm urgent service or choose another completion date.",
    code: "urgent_confirmation_required",
    issues,
  }), { status: 409, headers: { "Content-Type": "application/json" } });
}

function repricedCart(items: readonly CartItem[]) {
  return {
    version: 1 as const,
    market: "AU" as const,
    currency: "AUD" as const,
    taxJurisdiction: "NONE" as const,
    taxRateBasisPoints: 1_000,
    priceBookRevision: 9,
    orderDate: "2026-08-24",
    items: items.map((cartItem, index) => ({
      clientItemId: cartItem.id,
      productKey: cartItem.productKey,
      productSlug: cartItem.productSlug,
      productTitle: cartItem.productTitle,
      sizeKey: cartItem.sizeKey,
      sizeLabel: cartItem.sizeLabel,
      orientation: cartItem.orientation,
      peoplePets: cartItem.peoplePets,
      photoSubmissionMethod: cartItem.photoSubmissionMethod,
      designText: cartItem.designText,
      notes: cartItem.notes,
      neededDate: cartItem.neededDate,
      urgentServiceConfirmed: cartItem.urgentServiceConfirmed === true,
      urgentService: { workingDays: 5, feeInclGstCents: 10_000 + index * 2_500 },
      quantity: cartItem.quantity,
      uploadReferences: cartItem.uploadReferences,
      unitPrice: {
        market: "AU" as const,
        currency: "AUD" as const,
        taxJurisdiction: "NONE" as const,
        taxRateBasisPoints: 1_000,
        discountCents: 0,
        designSurchargeCents: 0,
        lines: [],
        subtotalExGstCents: 40_000,
        gstCents: 0,
        totalInclGstCents: 40_000,
      },
      lineSubtotalExGstCents: 40_000,
      lineGstCents: 0,
      lineTotalInclGstCents: 40_000,
    })),
    subtotalExGstCents: 40_000 * items.length,
    gstCents: 0,
    totalInclGstCents: 40_000 * items.length,
    discountCents: 0,
    designSurchargeCents: 0,
    itemCount: items.length,
    cartDigest: "a".repeat(64),
  };
}

function successResponse(items: readonly CartItem[]) {
  return new Response(JSON.stringify({
    market: "AU",
    currency: "AUD",
    cart: repricedCart(items),
  }), { status: 200, headers: { "Content-Type": "application/json" } });
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    setActiveCustomerId(null);
    resolveSwitch(successResponse([item()]));

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

  it("opens an urgent review and confirms only affected items before one navigation", async () => {
    const items = [
      item(),
      item({ id: "item-2", productTitle: "Photo Print Canvas", urgentServiceConfirmed: false }),
      item({ id: "item-3", productTitle: "Banner Bundle", urgentServiceConfirmed: false }),
    ];
    const original = seedCart(items);
    const cartChanged = vi.fn();
    const unsubscribe = subscribeToCart(cartChanged);
    const marketChanged = vi.fn();
    window.addEventListener("rnr:market-changed", marketChanged);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(urgentResponse([
        issue(),
        issue({ clientItemId: "item-2", productTitle: "Photo Print Canvas" }),
      ]))
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        const retryItems = body.cart.items as Array<{ clientItemId: string; urgentServiceConfirmed: boolean }>;
        expect(retryItems.find((entry) => entry.clientItemId === "item-1")?.urgentServiceConfirmed).toBe(true);
        expect(retryItems.find((entry) => entry.clientItemId === "item-2")?.urgentServiceConfirmed).toBe(true);
        expect(retryItems.find((entry) => entry.clientItemId === "item-3")?.urgentServiceConfirmed).toBe(false);
        return successResponse(items.map((cartItem) => ({
          ...cartItem,
          urgentServiceConfirmed: cartItem.id !== "item-3",
        })));
      });
    vi.stubGlobal("fetch", fetchMock);
    render(<MarketSelector market="NZ" australiaEnabled pathname="/products/custom-themed-canvas" />);

    fireEvent.change(screen.getByRole("combobox", { name: "Country and currency" }), {
      target: { value: "AU" },
    });

    expect(await screen.findByRole("dialog", { name: "Review urgent service" }))
      .toBeInTheDocument();
    expect(screen.getByText("Custom Themed Canvas")).toBeInTheDocument();
    expect(screen.getByText("Photo Print Canvas")).toBeInTheDocument();
    expect(localStorage.getItem("rnr:commerce:v1:guest:cart")).toBe(JSON.stringify(original));

    fireEvent.click(screen.getByRole("button", { name: "Confirm urgent service and switch" }));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(push).toHaveBeenCalledWith("/au/products/custom-themed-canvas");
    expect(refresh).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const stored = JSON.parse(localStorage.getItem("rnr:commerce:v1:guest:cart")!);
    expect(stored.items.map((entry: CartItem) => entry.urgentServiceConfirmed)).toEqual([
      true,
      true,
      false,
    ]);
    expect(stored.items[0].price).toMatchObject({ currency: "AUD", totalInclGstCents: 40_000 });
    expect(cartChanged).toHaveBeenCalledTimes(1);
    expect(marketChanged).toHaveBeenCalledTimes(1);
    unsubscribe();
    window.removeEventListener("rnr:market-changed", marketChanged);
  });

  it("retries a temporary edited date with confirmation reset without changing storage", async () => {
    const original = seedCart([item({ urgentServiceConfirmed: true })]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(urgentResponse())
      .mockResolvedValueOnce(urgentResponse());
    vi.stubGlobal("fetch", fetchMock);
    render(<MarketSelector market="NZ" australiaEnabled pathname="/" />);

    fireEvent.change(screen.getByRole("combobox", { name: "Country and currency" }), {
      target: { value: "AU" },
    });
    const date = await screen.findByLabelText("Completion date for Custom Themed Canvas");
    fireEvent.change(date, { target: { value: "2026-09-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Try these dates" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const retry = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(retry.cart.items[0]).toMatchObject({
      clientItemId: "item-1",
      neededDate: "2026-09-10",
      urgentServiceConfirmed: false,
    });
    expect(localStorage.getItem("rnr:commerce:v1:guest:cart")).toBe(JSON.stringify(original));
    expect(push).not.toHaveBeenCalled();
  });

  it("requires refreshed authoritative fees before confirming an edited urgent date", async () => {
    seedCart();
    const editedItem = item({ neededDate: "2026-08-27" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(urgentResponse([issue({
        neededDate: "2026-08-28",
        urgentWorkingDays: 5,
        urgentFeeInclGstCents: 10_000,
      })]))
      .mockResolvedValueOnce(urgentResponse([issue({
        neededDate: "2026-08-27",
        urgentWorkingDays: 4,
        urgentFeeInclGstCents: 15_000,
      })]))
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.cart.items[0]).toMatchObject({
          clientItemId: "item-1",
          neededDate: "2026-08-27",
          urgentServiceConfirmed: true,
        });
        return successResponse([{ ...editedItem, urgentServiceConfirmed: true }]);
      });
    vi.stubGlobal("fetch", fetchMock);
    render(<MarketSelector market="NZ" australiaEnabled pathname="/" />);

    fireEvent.change(screen.getByRole("combobox", { name: "Country and currency" }), {
      target: { value: "AU" },
    });
    const date = await screen.findByLabelText("Completion date for Custom Themed Canvas");
    fireEvent.change(date, { target: { value: "2026-08-27" } });

    const staleConfirm = screen.getByRole("button", {
      name: "Confirm urgent service and switch",
    });
    expect(staleConfirm).toBeDisabled();
    fireEvent.click(staleConfirm);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Try these dates" }));

    expect(await screen.findByText("A$150.00 AUD")).toBeInTheDocument();
    const refreshedConfirm = screen.getByRole("button", {
      name: "Confirm urgent service and switch",
    });
    expect(refreshedConfirm).toBeEnabled();
    fireEvent.click(refreshedConfirm);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/au"));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("cancels without changing cart, checkout state, events, or navigation", async () => {
    const original = seedCart();
    localStorage.setItem("rnr:commerce:v1:guest:checkout:pending", "pending");
    const marketChanged = vi.fn();
    window.addEventListener("rnr:market-changed", marketChanged);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(urgentResponse()));
    render(<MarketSelector market="NZ" australiaEnabled pathname="/" />);

    fireEvent.change(screen.getByRole("combobox", { name: "Country and currency" }), {
      target: { value: "AU" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Review urgent service" })).not.toBeInTheDocument();
    expect(localStorage.getItem("rnr:commerce:v1:guest:cart")).toBe(JSON.stringify(original));
    expect(localStorage.getItem("rnr:commerce:v1:guest:checkout:pending")).toBe("pending");
    expect(marketChanged).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    window.removeEventListener("rnr:market-changed", marketChanged);
  });

  it("shows safe non-urgent API errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "This market is not available yet.",
      code: "market_unavailable",
    }), { status: 409, headers: { "Content-Type": "application/json" } })));
    render(<MarketSelector market="NZ" australiaEnabled pathname="/" />);

    fireEvent.change(screen.getByRole("combobox", { name: "Country and currency" }), {
      target: { value: "AU" },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("This market is not available yet.");
    expect(push).not.toHaveBeenCalled();
  });

  it("closes the urgent dialog and shows a safe error when a retry fails", async () => {
    seedCart();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(urgentResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: "The cart could not be repriced for this market.",
        code: "invalid_cart",
      }), { status: 409, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<MarketSelector market="NZ" australiaEnabled pathname="/" />);

    fireEvent.change(screen.getByRole("combobox", { name: "Country and currency" }), {
      target: { value: "AU" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Try these dates" }));

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("The cart could not be repriced for this market.");
    expect(screen.queryByRole("dialog", { name: "Review urgent service" }))
      .not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("ignores repeat confirmation clicks while the retry is pending", async () => {
    seedCart();
    let resolveRetry!: (response: Response) => void;
    const retry = new Promise<Response>((resolve) => { resolveRetry = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(urgentResponse())
      .mockReturnValueOnce(retry);
    vi.stubGlobal("fetch", fetchMock);
    render(<MarketSelector market="NZ" australiaEnabled pathname="/" />);

    fireEvent.change(screen.getByRole("combobox", { name: "Country and currency" }), {
      target: { value: "AU" },
    });
    const confirm = await screen.findByRole("button", { name: "Confirm urgent service and switch" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolveRetry(successResponse([{ ...item(), urgentServiceConfirmed: true }]));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  });

  it("closes with Escape, restores selector focus, and unlocks body scrolling", async () => {
    seedCart();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(urgentResponse()));
    render(
      <>
        <MarketSelector market="NZ" australiaEnabled pathname="/" />
        <button type="button">Background action</button>
      </>,
    );
    const selector = screen.getByRole("combobox", { name: "Country and currency" });
    selector.focus();

    fireEvent.change(selector, { target: { value: "AU" } });
    screen.getByRole("button", { name: "Background action" }).focus();
    expect(selector).not.toHaveFocus();
    expect(await screen.findByRole("dialog", { name: "Review urgent service" })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Review urgent service" })).not.toBeInTheDocument();
    expect(selector).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });
});
