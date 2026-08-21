import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FormsOrderEntryData } from "./forms-workbench";
import { FormsOrderEntryDrawer } from "./forms-order-entry-drawer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const data: FormsOrderEntryData = {
  assignees: [{ id: "artist-1", name: "Artist", email: "artist@example.test", role: "staff" }],
  canManageFinance: true,
  canUploadFiles: true,
  submittedBy: "Ronnie Li",
  productTitles: ["Photo Print Canvas"],
  customFields: [],
  invoiceBusiness: {
    name: "R&R Gallery",
    address: "11 Para Close\nAuckland 0632",
    email: "customerservice@rnrgallery.com",
    phone: "+64 21 023 48948",
    website: "https://rnrgallery.com/",
    gstNumber: "125-796-389",
    bankAccount: "04-2021-0317735-07",
  },
};

const originalInnerWidth = window.innerWidth;

function viewport(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
}

afterEach(() => {
  viewport(originalInnerWidth);
  vi.restoreAllMocks();
});

describe("FormsOrderEntryDrawer", () => {
  it("passes payment-proof upload capability into Order Entry", () => {
    render(<FormsOrderEntryDrawer data={data} onClose={vi.fn()} />);

    expect(screen.getByLabelText("PaymtProved")).toBeInTheDocument();
    expect(screen.queryByText("operator@example.test")).not.toBeInTheDocument();
  });

  it("resizes from its left edge and resets when reopened", () => {
    viewport(1_200);
    const first = render(<FormsOrderEntryDrawer data={data} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Order entry" });
    const separator = screen.getByRole("separator", { name: "Resize order entry" });

    expect(separator).toHaveAttribute("aria-valuemin", "520");
    expect(separator).toHaveAttribute("aria-valuemax", "920");
    expect(separator).toHaveAttribute("aria-valuenow", "864");
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(dialog).toHaveStyle({ "--entry-drawer-width": "884px" });

    first.unmount();
    render(<FormsOrderEntryDrawer data={data} onClose={vi.fn()} />);
    expect(screen.getByRole("separator", { name: "Resize order entry" })).toHaveAttribute("aria-valuenow", "864");
  });

  it("leaves the required Data list width at desktop and fills the 390px viewport", () => {
    viewport(1_000);
    const desktop = render(<FormsOrderEntryDrawer data={data} onClose={vi.fn()} />);
    expect(screen.getByRole("separator", { name: "Resize order entry" })).toHaveAttribute("aria-valuemax", "720");
    expect(screen.getByRole("dialog", { name: "Order entry" })).toHaveStyle({ "--entry-drawer-width": "720px" });

    desktop.unmount();
    viewport(390);
    render(<FormsOrderEntryDrawer data={data} onClose={vi.fn()} />);
    expect(screen.getByRole("separator", { name: "Resize order entry" })).toHaveAttribute("aria-valuemax", "390");
    expect(screen.getByRole("dialog", { name: "Order entry" })).toHaveStyle({ "--entry-drawer-width": "390px" });
  });

  it("guards unsaved manual entry before closing", () => {
    const onClose = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<FormsOrderEntryDrawer data={data} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("Cust.Name"), { target: { value: "New customer" } });
    fireEvent.click(screen.getByRole("button", { name: "Close order entry" }));
    expect(confirm).toHaveBeenCalledWith("Discard this unsaved manual order?");
    expect(onClose).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Close order entry" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("treats a selected payment proof as unsaved drawer work", () => {
    const onClose = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<FormsOrderEntryDrawer data={data} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("PaymtProved"), {
      target: {
        files: [new File([new Uint8Array([0xff, 0xd8, 0xff])], "receipt.jpg", { type: "image/jpeg" })],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close order entry" }));

    expect(confirm).toHaveBeenCalledWith("Discard this unsaved manual order?");
    expect(onClose).not.toHaveBeenCalled();
  });
});
