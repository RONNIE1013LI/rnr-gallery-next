import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCartStorageKey,
  getCheckoutDraftStorageKey,
  getPaymentIntentStorageKey,
  getPendingCheckoutStorageKey,
} from "@/domain/cart/browser-cart-scope";
import type { Cart } from "@/domain/cart/types";
import { getAttributionStorageKey } from "@/domain/analytics/attribution";
import { AccountSignOut } from "./account-sign-out";
import { CartCount } from "./cart-count";
import { CheckoutEntrySummary } from "./checkout-entry-summary";
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

function bundleCart(
  id: string,
  rollUpMethod: "upload" | "later",
  wallMethod: "upload" | "later",
  uploadCount: number,
): Cart {
  const uploads = Array.from(
    { length: uploadCount },
    (_, index) => `blob:${id}-private-${index + 1}.jpg`,
  );
  const component = (componentKey: "roll-up" | "wall-banner", method: "upload" | "later") => ({
    componentKey,
    photoSubmissionMethod: method,
    designText: `${id} private wording`,
    notes: `${id} private notes`,
    uploadReferences: method === "upload" ? uploads : [],
    ...(method === "upload" ? { mainPhotoUploadId: uploads[0] } : {}),
  });
  return {
    version: 1,
    items: [{
      ...cart("Banner Bundle").items[0],
      id,
      productKey: "banner-bundle",
      productSlug: "banner-bundle",
      productTitle: "Banner Bundle",
      photoSubmissionMethod: rollUpMethod === "upload" || wallMethod === "upload" ? "upload" : "later",
      uploadReferences: uploads,
      bundleComponents: [component("roll-up", rollUpMethod), component("wall-banner", wallMethod)],
    }],
  };
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
    sessionStorage.setItem(getAttributionStorageKey("customer-a"), JSON.stringify({ utm_source: "google" }));
    sessionStorage.setItem(getAttributionStorageKey(null), JSON.stringify({ utm_source: "guest" }));
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
    expect(sessionStorage.getItem(getAttributionStorageKey("customer-a"))).toBeNull();
    expect(sessionStorage.getItem(getAttributionStorageKey(null))).toBeNull();
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

  it("never exposes another identity's Bundle customisations across Guest, A, sign out, and B", () => {
    localStorage.setItem(
      getCartStorageKey(null),
      JSON.stringify(bundleCart("guest-bundle", "later", "later", 0)),
    );
    localStorage.setItem(
      getCartStorageKey("customer-a"),
      JSON.stringify(bundleCart("a-bundle", "upload", "later", 1)),
    );
    localStorage.setItem(
      getCartStorageKey("customer-b"),
      JSON.stringify(bundleCart("b-bundle", "later", "upload", 2)),
    );
    render(
      <CommerceIdentityProvider initialCustomerId={null}>
        <IdentityControls />
        <CheckoutEntrySummary />
      </CommerceIdentityProvider>,
    );

    let rollUp = screen.getByLabelText("Roll-Up Banner customisation summary");
    let wallBanner = screen.getByLabelText("Wall Banner customisation summary");
    expect(rollUp).toHaveTextContent("Send Later");
    expect(wallBanner).toHaveTextContent("Send Later");

    fireEvent.click(screen.getByRole("button", { name: "User A" }));
    rollUp = screen.getByLabelText("Roll-Up Banner customisation summary");
    wallBanner = screen.getByLabelText("Wall Banner customisation summary");
    expect(rollUp).toHaveTextContent("Upload Now");
    expect(rollUp).toHaveTextContent("1 photo");
    expect(wallBanner).toHaveTextContent("Send Later");

    fireEvent.click(screen.getByRole("button", { name: "Guest" }));
    expect(screen.getByLabelText("Roll-Up Banner customisation summary")).toHaveTextContent(
      "Send Later",
    );
    expect(screen.getByLabelText("Wall Banner customisation summary")).toHaveTextContent(
      "Send Later",
    );

    fireEvent.click(screen.getByRole("button", { name: "User B" }));
    rollUp = screen.getByLabelText("Roll-Up Banner customisation summary");
    wallBanner = screen.getByLabelText("Wall Banner customisation summary");
    expect(rollUp).toHaveTextContent("Send Later");
    expect(wallBanner).toHaveTextContent("Upload Now");
    expect(wallBanner).toHaveTextContent("2 photos");
    expect(screen.queryByText(/private wording|private notes|blob:/)).not.toBeInTheDocument();
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

  it("hands Guest click IDs to the first authenticated identity without leaking to another user", async () => {
    sessionStorage.setItem(getAttributionStorageKey(null), JSON.stringify({
      gclid: "guest-google",
      gbraid: "guest-app",
      wbraid: "guest-web",
      fbclid: "guest-meta",
      utm_campaign: "guest-campaign",
    }));
    const view = render(
      <CommerceIdentityProvider initialCustomerId={null}><CartCount /></CommerceIdentityProvider>,
    );

    view.rerender(
      <CommerceIdentityProvider initialCustomerId="customer-a"><CartCount /></CommerceIdentityProvider>,
    );
    await waitFor(() => expect(sessionStorage.getItem(getAttributionStorageKey("customer-a")))
      .not.toBeNull());
    expect(JSON.parse(sessionStorage.getItem(getAttributionStorageKey("customer-a"))!)).toEqual({
      gclid: "guest-google",
      gbraid: "guest-app",
      wbraid: "guest-web",
      fbclid: "guest-meta",
      utm_campaign: "guest-campaign",
    });
    expect(sessionStorage.getItem(getAttributionStorageKey(null))).toBeNull();

    view.rerender(
      <CommerceIdentityProvider initialCustomerId="customer-b"><CartCount /></CommerceIdentityProvider>,
    );
    await waitFor(() => expect(sessionStorage.getItem(getAttributionStorageKey("customer-a")))
      .toBeNull());
    expect(sessionStorage.getItem(getAttributionStorageKey("customer-b"))).toBeNull();
  });

  it("does not overwrite existing authenticated attribution during Guest login", async () => {
    sessionStorage.setItem(getAttributionStorageKey(null), JSON.stringify({ fbclid: "stale-meta" }));
    sessionStorage.setItem(getAttributionStorageKey("customer-a"), JSON.stringify({
      gclid: "existing-google",
    }));
    const view = render(
      <CommerceIdentityProvider initialCustomerId={null}><CartCount /></CommerceIdentityProvider>,
    );

    view.rerender(
      <CommerceIdentityProvider initialCustomerId="customer-a"><CartCount /></CommerceIdentityProvider>,
    );
    await waitFor(() => expect(sessionStorage.getItem(getAttributionStorageKey(null))).toBeNull());
    expect(JSON.parse(sessionStorage.getItem(getAttributionStorageKey("customer-a"))!)).toEqual({
      gclid: "existing-google",
    });
  });
});
