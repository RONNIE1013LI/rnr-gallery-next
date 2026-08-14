import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FormsOrderCards } from "./forms-order-cards";
import { formOrderRow } from "./forms-test-data";

describe("FormsOrderCards", () => {
  it("keeps essential operational and finance context reachable on mobile", () => {
    const onOpen = vi.fn();
    render(<FormsOrderCards rows={[formOrderRow]} canViewFinance onOpen={onOpen} />);

    expect(screen.getByText("07188")).toBeInTheDocument();
    expect(screen.getByText("Elena Lasalo")).toBeInTheDocument();
    expect(screen.getByText("A0")).toBeInTheDocument();
    expect(screen.getByText("Post")).toBeInTheDocument();
    expect(screen.getByText("$130.00 owing")).toBeInTheDocument();
    expect(screen.getByText("Designing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open order 07188" }));
    expect(onOpen).toHaveBeenCalledWith("job-1");
  });
});
