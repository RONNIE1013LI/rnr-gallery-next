import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import FormsPortalError from "./error";
import { FormsInitialLoading } from "./initial-loading";
import FormsPortalNotFound from "./not-found";

describe("forms portal route states", () => {
  it("announces a lightweight initial loading state", () => {
    render(<FormsInitialLoading />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading orders");
    expect(screen.getByRole("status").children).toHaveLength(0);
  });

  it("explains a read failure without suggesting records were changed", () => {
    const reset = vi.fn();
    render(<FormsPortalError error={new Error("database unavailable")} reset={reset} />);

    expect(screen.getByRole("heading", { name: "The order workspace could not be loaded." })).toBeInTheDocument();
    expect(screen.getByText(/business records have not been changed/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("provides safe recovery links for a missing record", () => {
    render(<FormsPortalNotFound />);

    expect(screen.getByRole("heading", { name: "Order record not found." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Data list" })).toHaveAttribute("href", "/order-system");
    expect(screen.getByRole("link", { name: "Order entry" })).toHaveAttribute("href", "/order-system/new");
  });
});
