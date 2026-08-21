import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FormsOrderCards } from "./forms-order-cards";
import { formOrderRow } from "./forms-test-data";

describe("FormsOrderCards", () => {
  it("shows only the approved compact mobile order fields", () => {
    const onOpen = vi.fn();
    render(<FormsOrderCards rows={[formOrderRow]} startIndex={0} canViewFinance onOpen={onOpen} />);

    expect(screen.getByText("07188")).toBeInTheDocument();
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("2026-08-05 12:00:00")).toBeInTheDocument();
    expect(screen.getByText("Cust.Name")).toBeInTheDocument();
    expect(screen.getByText("Elena Lasalo")).toBeInTheDocument();
    expect(screen.getByText("A0")).toBeInTheDocument();
    expect(screen.getByText("AmtOwe")).toBeInTheDocument();
    expect(screen.getByText("130.00")).toBeInTheDocument();
    expect(screen.getByText("AmtPayable")).toBeInTheDocument();
    expect(screen.getByText("230.00")).toBeInTheDocument();
    expect(screen.getByText("DlvryMethod")).toBeInTheDocument();
    expect(screen.getByText("Post")).toBeInTheDocument();
    expect(screen.getByText("Delivered")).toBeInTheDocument();
    expect(screen.getByText("NO")).toBeInTheDocument();
    expect(screen.queryByText("Needed")).not.toBeInTheDocument();
    expect(screen.queryByText("Designing")).not.toBeInTheDocument();
    expect(screen.queryByText("Rosemary")).not.toBeInTheDocument();
    expect(screen.queryByText("Urgent")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open order 07188" }));
    expect(onOpen).toHaveBeenCalledWith("job-1");
  });

  it("does not expose finance fields without finance access", () => {
    render(<FormsOrderCards rows={[formOrderRow]} startIndex={20} canViewFinance={false} onOpen={vi.fn()} />);

    expect(screen.getByText("#21")).toBeInTheDocument();
    expect(screen.queryByText("AmtOwe")).not.toBeInTheDocument();
    expect(screen.queryByText("AmtPayable")).not.toBeInTheDocument();
  });

  it("keeps a long website reference available when its mobile display is truncated", () => {
    const reference = "Web-RNR-2026-7B7F730CD3";
    render(<FormsOrderCards rows={[{ ...formOrderRow, reference }]} startIndex={0} canViewFinance onOpen={vi.fn()} />);

    expect(screen.getByRole("button", { name: `Open order ${reference}` })).toHaveAttribute("title", reference);
  });
});
