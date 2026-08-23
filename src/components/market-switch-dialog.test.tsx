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

const state = {
  targetMarket: "AU" as const,
  cart,
  message: "Confirm urgent service or choose another completion date.",
  issues: [
    {
      clientItemId: "item-1",
      productTitle: "Custom Themed Canvas",
      neededDate: "2026-08-28",
      urgentWorkingDays: 5,
      urgentFeeInclGstCents: 10_000,
      currency: "AUD" as const,
    },
    {
      clientItemId: "item-2",
      productTitle: "Photo Print Canvas",
      neededDate: "2026-08-29",
      urgentWorkingDays: 4,
      urgentFeeInclGstCents: 12_500,
      currency: "AUD" as const,
    },
  ],
};

describe("MarketSwitchDialog", () => {
  it("shows every server-provided issue with target-market fees and native date inputs", () => {
    render(
      <MarketSwitchDialog
        state={state}
        pending={false}
        onDateChange={vi.fn()}
        onConfirmUrgent={vi.fn()}
        onTryDates={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Review urgent service" });
    expect(dialog).toBeInTheDocument();
    expect(dialog.closest("[role='presentation']")?.parentElement).toBe(document.body);
    expect(screen.getByText("Switching to Australia — AUD")).toBeInTheDocument();
    expect(screen.getByText("Custom Themed Canvas")).toBeInTheDocument();
    expect(screen.getByText("Photo Print Canvas")).toBeInTheDocument();
    expect(screen.getByText("A$100.00 AUD")).toBeInTheDocument();
    expect(screen.getByText("A$125.00 AUD")).toBeInTheDocument();
    expect(screen.getByLabelText("Completion date for Custom Themed Canvas"))
      .toHaveAttribute("type", "date");
    expect(screen.getByLabelText("Completion date for Photo Print Canvas"))
      .toHaveValue("2026-08-29");
  });

  it("reports date edits and keeps keyboard focus trapped within its controls", () => {
    const onDateChange = vi.fn();
    render(
      <MarketSwitchDialog
        state={state}
        pending={false}
        onDateChange={onDateChange}
        onConfirmUrgent={vi.fn()}
        onTryDates={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const first = screen.getByLabelText("Completion date for Custom Themed Canvas");
    const last = screen.getByRole("button", { name: "Cancel" });
    expect(first).toHaveFocus();

    fireEvent.change(first, { target: { value: "2026-09-10" } });
    expect(onDateChange).toHaveBeenCalledWith("item-1", "2026-09-10");

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(first).toHaveFocus();

    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it("closes on Escape and disables every action while pending", () => {
    const onCancel = vi.fn();
    render(
      <MarketSwitchDialog
        state={state}
        pending
        onDateChange={vi.fn()}
        onConfirmUrgent={vi.fn()}
        onTryDates={vi.fn()}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole("button", { name: "Switching market…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Try these dates" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    const dialog = screen.getByRole("dialog", { name: "Review urgent service" });
    expect(dialog).toHaveAttribute("tabindex", "-1");
    expect(dialog).toHaveFocus();
    expect(fireEvent.keyDown(document, { key: "Tab" })).toBe(false);
    expect(dialog).toHaveFocus();
    expect(fireEvent.keyDown(document, { key: "Tab", shiftKey: true })).toBe(false);
    expect(dialog).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("contains both Tab directions when a repeated conflict re-enables controls", () => {
    const props = {
      state,
      onDateChange: vi.fn(),
      onConfirmUrgent: vi.fn(),
      onTryDates: vi.fn(),
      onCancel: vi.fn(),
    };
    const { rerender } = render(<MarketSwitchDialog {...props} pending />);
    const dialog = screen.getByRole("dialog", { name: "Review urgent service" });
    expect(dialog).toHaveFocus();

    rerender(<MarketSwitchDialog {...props} pending={false} />);
    expect(screen.getByRole("button", {
      name: "Confirm urgent service and switch",
    })).toBeEnabled();
    expect(dialog).toHaveFocus();

    expect(fireEvent.keyDown(document, { key: "Tab" })).toBe(false);
    expect(screen.getByLabelText("Completion date for Custom Themed Canvas"))
      .toHaveFocus();

    dialog.focus();
    expect(fireEvent.keyDown(document, { key: "Tab", shiftKey: true })).toBe(false);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });
});
