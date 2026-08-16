import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FormsShell } from "./forms-shell";

const { searchParams } = vi.hoisted(() => ({ searchParams: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => searchParams }));

describe("FormsShell", () => {
  beforeEach(() => {
    searchParams.delete("q");
    searchParams.delete("page");
    searchParams.delete("entry");
  });

  it("renders the focused source-style navigation for an operator", () => {
    searchParams.set("q", "07188");
    searchParams.set("page", "2");
    render(
      <FormsShell
        operator={{ name: "Rosemary", email: "rosemary@example.test" }}
        canCreateJobs
        canViewStats
        currentPath="/order-system"
      >
        <p>Workbench</p>
      </FormsShell>,
    );

    expect(screen.getByRole("link", { name: "Data list" })).toHaveAttribute("href", "/order-system");
    expect(screen.getByRole("link", { name: "Data list" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Custom stats" })).toHaveAttribute("href", "/order-system/stats");
    expect(screen.getByRole("link", { name: "Gallery" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Order entry" })).toHaveAttribute("href", "/order-system?q=07188&page=2&entry=new");
    expect(screen.getByText("Rosemary")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
    expect(screen.queryByText("Order manager")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Dashboard" })).not.toBeInTheDocument();
  });

  it("hides unavailable statistics and creation actions", () => {
    render(
      <FormsShell
        operator={{ name: "Viewer", email: "viewer@example.test" }}
        canCreateJobs={false}
        canViewStats={false}
      >
        <p>Read only</p>
      </FormsShell>,
    );

    expect(screen.queryByRole("link", { name: "Custom stats" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Order entry" })).not.toBeInTheDocument();
  });
});
