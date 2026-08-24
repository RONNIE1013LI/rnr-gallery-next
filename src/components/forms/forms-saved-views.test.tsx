import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FormsSavedViews } from "./forms-saved-views";

afterEach(() => vi.unstubAllGlobals());

describe("forms saved views", () => {
  it("keeps save controls separate from the full-width saved-view list", () => {
    render(<FormsSavedViews
      views={[{ id: "view-1", name: "Urgent", queryString: "filter=urgent%7Eequals%7Etrue" }]}
      currentQuery="filter=deliveryMethod%7Eequals%7Epickup"
      onChanged={vi.fn()}
      onOpen={vi.fn()}
    />);

    const controls = screen.getByRole("group", { name: "Save a search" });
    expect(controls).toContainElement(screen.getByLabelText("Saved view name"));
    expect(controls).toContainElement(screen.getByRole("button", { name: "Save current view" }));
    expect(controls).not.toContainElement(screen.getByLabelText("Personal saved views"));
  });

  it("saves the current operational filters and opens a personal view", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: "created" }), { status: 201 }));
    vi.stubGlobal("fetch", request);
    const changed = vi.fn();
    const open = vi.fn();
    render(<FormsSavedViews
      views={[{ id: "view-1", name: "Urgent", queryString: "filter=urgent%7Eequals%7Etrue" }]}
      currentQuery="filter=deliveryMethod%7Eequals%7Epickup"
      onChanged={changed}
      onOpen={open}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Urgent" }));
    expect(open).toHaveBeenCalledWith("filter=urgent%7Eequals%7Etrue");
    fireEvent.change(screen.getByLabelText("Saved view name"), { target: { value: "Pickup" } });
    fireEvent.click(screen.getByRole("button", { name: "Save current view" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/forms/views", expect.objectContaining({ method: "POST" })));
    expect(changed).toHaveBeenCalled();
  });

  it("sends saved-view deletes through the JSON mutation boundary", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: "deleted" })));
    vi.stubGlobal("fetch", request);
    const changed = vi.fn();
    render(<FormsSavedViews
      views={[{ id: "view-1", name: "Urgent", queryString: "filter=urgent%7Eequals%7Etrue" }]}
      currentQuery="filter=urgent%7Eequals%7Etrue"
      onChanged={changed}
      onOpen={vi.fn()}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Delete Urgent" }));

    await waitFor(() => expect(request).toHaveBeenCalledWith(
      "/api/forms/views/view-1",
      expect.objectContaining({
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      }),
    ));
    expect(changed).toHaveBeenCalled();
  });
});
