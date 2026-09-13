import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { calculateFixedPackage } from "@/domain/pricing/calculate-fixed-package";
import type { Cart, CartItem } from "@/domain/cart/types";
import { MarketSwitchDialog } from "./market-switch-dialog";

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

const cart: Cart = {
  version: 1,
  items: [
    item(),
    item({
      id: "item-2",
      productKey: "photo-print-canvas",
      productSlug: "photo-print-canvas",
      productTitle: "Photo Print Canvas",
      neededDate: "2026-08-29",
    }),
  ],
};

const state = { targetMarket: "AU" as const, cart };

describe("MarketSwitchDialog", () => {
  it("offers configuration links with no date or rush mutators", () => {
    const onCancel = vi.fn();
    render(<MarketSwitchDialog state={state} pending={false} onConfirm={vi.fn()} onCancel={onCancel} />);
    const dialog = screen.getByRole("dialog", { name: "Keep your configured cart" });
    expect(dialog.closest("[role='presentation']")?.parentElement).toBe(document.body);
    expect(screen.getByText("Switching to Australia — AUD")).toBeVisible();
    expect(screen.getAllByRole("link", { name: /Edit configuration/ })).toHaveLength(2);
    expect(document.querySelector("input")).toBeNull();
    expect(screen.queryByRole("button", { name: /rush|urgent/i })).not.toBeInTheDocument();
    const editLink = screen.getAllByRole("link")[0];
    editLink.addEventListener("click", (event) => event.preventDefault(), { once: true });
    fireEvent.click(editLink);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("traps keyboard focus and handles Escape", () => {
    const onCancel = vi.fn();
    render(<MarketSwitchDialog state={state} pending={false} onConfirm={vi.fn()} onCancel={onCancel} />);
    const first = screen.getAllByRole("link")[0];
    const last = screen.getByRole("button", { name: "Cancel" });
    expect(first).toHaveFocus();
    last.focus(); fireEvent.keyDown(document, { key: "Tab" }); expect(first).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true }); expect(last).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" }); expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables all navigation and contains focus while pending", () => {
    const onCancel = vi.fn();
    const { rerender } = render(<MarketSwitchDialog state={state} pending onConfirm={vi.fn()} onCancel={onCancel} />);
    const dialog = screen.getByRole("dialog");
    expect(screen.getByRole("button", { name: "Switching market…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" }); expect(dialog).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true }); expect(dialog).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" }); expect(onCancel).not.toHaveBeenCalled();
    rerender(<MarketSwitchDialog state={state} pending={false} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: "Tab" }); expect(screen.getAllByRole("link")[0]).toHaveFocus();
    dialog.focus(); fireEvent.keyDown(document, { key: "Tab", shiftKey: true }); expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });
});
