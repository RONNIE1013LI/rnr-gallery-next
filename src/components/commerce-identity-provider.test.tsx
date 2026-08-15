import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCartStorageKey,
  getCheckoutDraftStorageKey,
  getPaymentIntentStorageKey,
  getPendingCheckoutStorageKey,
} from "@/domain/cart/browser-cart-scope";
import type { Cart } from "@/domain/cart/types";
import { AccountSignOut } from "./account-sign-out";
import { CartCount } from "./cart-count";
import { CommerceIdentityProvider, useCommerceIdentity } from "./commerce-identity-provider";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

function cart(title: string, quantity = 1): Cart {
  return { version: 1, items: [{
    id: title, productKey: "photo-print-canvas", productSlug: "photo-print-canvas",
    productTitle: title, imageSrc: "/test.jpg", sizeKey: "a4", sizeLabel: "A4",
    peoplePets: 0, photoSubmissionMethod: "later", designText: "", notes: "",
    neededDate: "2026-08-20", deliveryPreference: "pickup", quantity,
    price: { lines: [], subtotalExGstCents: 6500, gstCents: 975, totalInclGstCents: 7475 },
    uploadReferences: [],
  }] };
}

function IdentityControls() {
  const { activateUser, signOutToGuest } = useCommerceIdentity();
  return <>
    <button onClick={() => activateUser("customer-a")}>User A</button>
    <button onClick={() => activateUser("customer-b")}>User B</button>
    <button onClick={signOutToGuest}>Guest</button>
    <CartCount />
  </>;
}

describe("same-browser identity transitions", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    replace.mockReset();
  });

  it("hydrates only the signed-in user's cart and never merges the Guest cart", () => {
    localStorage.setItem(getCartStorageKey(null), JSON.stringify(cart("Guest Product", 3)));
    localStorage.setItem(getCartStorageKey("customer-a"), JSON.stringify(cart("Product A")));
    render(<CommerceIdentityProvider initialCustomerId={null}><IdentityControls /></CommerceIdentityProvider>);
    expect(screen.getByRole("link", { name: "Cart, 3 items" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "User A" }));
    expect(screen.getByRole("link", { name: "Cart, 1 items" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(getCartStorageKey("customer-a"))!).items[0].productTitle).toBe("Product A");
  });

  it("switches A to Guest immediately without refresh and clears only A checkout recovery", async () => {
    localStorage.setItem(getCartStorageKey("customer-a"), JSON.stringify(cart("Product A")));
    localStorage.setItem(getPendingCheckoutStorageKey("customer-a"), "pending-a");
    sessionStorage.setItem(getCheckoutDraftStorageKey("customer-a"), "draft-a");
    sessionStorage.setItem(getPaymentIntentStorageKey("customer-a"), "payment-a");
    render(<CommerceIdentityProvider initialCustomerId="customer-a">
      <CartCount />
      <AccountSignOut client={{ signOut: vi.fn().mockResolvedValue({ error: null }) }} />
    </CommerceIdentityProvider>);
    expect(screen.getByRole("link", { name: "Cart, 1 items" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "Cart, 0 items" })).toBeInTheDocument());
    expect(localStorage.getItem(getCartStorageKey("customer-a"))).not.toBeNull();
    expect(localStorage.getItem(getPendingCheckoutStorageKey("customer-a"))).toBeNull();
    expect(sessionStorage.getItem(getCheckoutDraftStorageKey("customer-a"))).toBeNull();
    expect(sessionStorage.getItem(getPaymentIntentStorageKey("customer-a"))).toBeNull();
  });

  it("switches A to B and back to A using only each identity's own cart", () => {
    localStorage.setItem(getCartStorageKey("customer-a"), JSON.stringify(cart("Product A")));
    localStorage.setItem(getCartStorageKey("customer-b"), JSON.stringify(cart("Product B", 2)));
    render(<CommerceIdentityProvider initialCustomerId="customer-a"><IdentityControls /></CommerceIdentityProvider>);
    expect(screen.getByRole("link", { name: "Cart, 1 items" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "User B" }));
    expect(screen.getByRole("link", { name: "Cart, 2 items" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "User A" }));
    expect(screen.getByRole("link", { name: "Cart, 1 items" })).toBeInTheDocument();
  });

  it("follows authenticated identity prop changes without remounting the layout", async () => {
    localStorage.setItem(getCartStorageKey("customer-a"), JSON.stringify(cart("Product A")));
    localStorage.setItem(getCartStorageKey("customer-b"), JSON.stringify(cart("Product B", 2)));
    const view = render(
      <CommerceIdentityProvider initialCustomerId="customer-a"><CartCount /></CommerceIdentityProvider>,
    );
    expect(screen.getByRole("link", { name: "Cart, 1 items" })).toBeInTheDocument();

    view.rerender(
      <CommerceIdentityProvider initialCustomerId={null}><CartCount /></CommerceIdentityProvider>,
    );
    await waitFor(() => expect(screen.getByRole("link", { name: "Cart, 0 items" })).toBeInTheDocument());

    view.rerender(
      <CommerceIdentityProvider initialCustomerId="customer-b"><CartCount /></CommerceIdentityProvider>,
    );
    await waitFor(() => expect(screen.getByRole("link", { name: "Cart, 2 items" })).toBeInTheDocument());
  });
});
