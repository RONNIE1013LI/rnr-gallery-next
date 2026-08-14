import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CopyOrderNumber } from "./copy-order-number";

describe("CopyOrderNumber", () => {
  it("copies the exact order number and confirms the action", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<CopyOrderNumber orderNumber="RNR-2026-ABC" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy order number" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("RNR-2026-ABC"));
    expect(screen.getByRole("button", { name: "Order number copied" })).toBeInTheDocument();
  });
});
