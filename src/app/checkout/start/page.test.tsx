import { readFileSync } from "node:fs";

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import styles from "@/components/storefront.module.css";

const { getConfiguredSocialProviderIds, getOptionalSession, redirect } = vi.hoisted(() => ({
  getConfiguredSocialProviderIds: vi.fn(() => ["google"]),
  getOptionalSession: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }),
}));

vi.mock("next/navigation", () => ({
  redirect,
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("@/server/auth/get-optional-session", () => ({ getOptionalSession }));
vi.mock("@/server/auth/social-provider-config", () => ({ getConfiguredSocialProviderIds }));

import CheckoutStartPage from "./page";

describe("CheckoutStartPage", () => {
  beforeEach(() => {
    localStorage.clear();
    getOptionalSession.mockReset();
    getOptionalSession.mockResolvedValue(null);
    redirect.mockClear();
  });

  it("presents account sign-in beside a simple guest checkout path", async () => {
    render(await CheckoutStartPage());

    expect(screen.getByRole("heading", {
      level: 1,
      name: "Sign in for faster checkout.",
    })).toBeInTheDocument();

    const account = screen.getByRole("region", {
      name: "Check out with your R&R Gallery account",
    });
    const guestCheckout = screen.getByRole("region", { name: "Guest Checkout" });
    const guest = screen.getByRole("link", { name: "Continue as Guest" });
    const google = screen.getByRole("button", { name: "Continue with Google" });
    const email = screen.getByRole("button", { name: "Continue with Email" });

    expect(account).toContainElement(google);
    expect(account).toContainElement(email);
    expect(guestCheckout).toContainElement(guest);
    expect(google.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(account.compareDocumentPosition(guestCheckout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(guest).toHaveAttribute("href", "/checkout");
    expect(google).toBeEnabled();
    expect(email).toBeEnabled();

    expect(screen.getByText("Proceed now and create an account later.")).toHaveClass(
      styles.checkoutGuestDescription,
    );
    expect(screen.queryByRole("complementary", { name: "Order summary" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to cart" })).toHaveAttribute("href", "/cart");

    fireEvent.click(email);
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      "/account/register?next=%2Fcheckout",
    );
  });

  it("sends signed-in customers straight to checkout", async () => {
    getOptionalSession.mockResolvedValue({ user: { id: "customer-1" } });

    await expect(CheckoutStartPage()).rejects.toThrow("REDIRECT:/checkout");
    expect(redirect).toHaveBeenCalledWith("/checkout");
  });

  it("keeps the guest checkout description on one line", () => {
    const css = readFileSync("src/components/storefront.module.css", "utf8");

    expect(css).toMatch(
      /\.checkoutGuestDescription\s*\{[\s\S]*?white-space:\s*nowrap;/,
    );
  });

});
