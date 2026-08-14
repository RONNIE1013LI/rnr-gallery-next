import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductionSavedViews } from "./production-saved-views";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("production saved views", () => {
  it("shows reusable filter links and a save control when operational filters are active", () => {
    render(<ProductionSavedViews
      views={[{ id: "e23a9f59-bf54-4bb6-a7d0-9239c14cf819", name: "Urgent print", queryString: "status=printing&urgent=yes" }]}
      currentQuery="urgent=yes"
    />);
    expect(screen.getByRole("link", { name: "Urgent print" })).toHaveAttribute("href", "/admin/jobs?status=printing&urgent=yes");
    expect(screen.getByRole("button", { name: "Save current filters" })).toBeInTheDocument();
  });
});
