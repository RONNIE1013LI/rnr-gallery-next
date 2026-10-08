import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("keeps edit and delete inside the saved search's more-actions menu", () => {
    render(<FormsSavedViews
      views={[{ id: "view-1", name: "Urgent", queryString: "filter=urgent%7Eequals%7Etrue" }]}
      currentQuery="filter=urgent%7Eequals%7Etrue"
      onChanged={vi.fn()}
      onOpen={vi.fn()}
    />);

    const group = within(screen.getByRole("group", { name: "Saved search Urgent" }));
    expect(group.getAllByRole("button")).toHaveLength(2);
    expect(group.getByRole("button", { name: "Urgent" })).toHaveAttribute("title", "Urgent");
    const more = group.getByRole("button", { name: "More actions for Urgent" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(more);
    const menu = within(screen.getByRole("menu", { name: "Actions for Urgent" }));
    expect(menu.getAllByRole("menuitem")).toHaveLength(2);
    expect(menu.getByRole("menuitem", { name: "Edit Urgent" })).toBeInTheDocument();
    expect(menu.getByRole("menuitem", { name: "Delete Urgent" })).toBeInTheDocument();
    expect(more).toHaveAttribute("aria-expanded", "true");
  });

  it("supports keyboard actions and closes only the menu on Escape", () => {
    render(<FormsSavedViews
      views={[{ id: "view-1", name: "Urgent", queryString: "filter=urgent%7Eequals%7Etrue" }]}
      currentQuery="filter=urgent%7Eequals%7Etrue"
      onChanged={vi.fn()}
      onOpen={vi.fn()}
    />);
    const more = screen.getByRole("button", { name: "More actions for Urgent" });
    fireEvent.click(more);
    const edit = screen.getByRole("menuitem", { name: "Edit Urgent" });
    const remove = screen.getByRole("menuitem", { name: "Delete Urgent" });
    expect(edit).toHaveFocus();
    // WebKit can blur a button without a new focus target before its click.
    fireEvent.blur(edit, { relatedTarget: null });
    expect(screen.getByRole("menu", { name: "Actions for Urgent" })).toBeInTheDocument();
    fireEvent.keyDown(edit, { key: "ArrowDown" });
    expect(remove).toHaveFocus();
    fireEvent.keyDown(remove, { key: "Home" });
    expect(edit).toHaveFocus();

    const parentEscape = vi.fn();
    document.addEventListener("keydown", parentEscape, true);
    try {
      fireEvent.keyDown(edit, { key: "Escape" });
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(more).toHaveFocus();
      expect(parentEscape).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", parentEscape, true);
    }
  });

  it("keeps one actions menu open and dismisses it outside without a mutation", () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    render(<FormsSavedViews
      views={[
        { id: "view-1", name: "Urgent", queryString: "filter=urgent%7Eequals%7Etrue" },
        { id: "view-2", name: "Post", queryString: "filter=deliveryMethod%7Eequals%7Epost" },
      ]}
      currentQuery="filter=urgent%7Eequals%7Etrue"
      onChanged={vi.fn()}
      onOpen={vi.fn()}
    />);
    fireEvent.click(screen.getByRole("button", { name: "More actions for Urgent" }));
    fireEvent.click(screen.getByRole("button", { name: "More actions for Post" }));
    expect(screen.queryByRole("menu", { name: "Actions for Urgent" })).not.toBeInTheDocument();
    expect(screen.getByRole("menu", { name: "Actions for Post" })).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByLabelText("Saved view name"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
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

    fireEvent.click(screen.getByRole("button", { name: "More actions for Urgent" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete Urgent" }));

    await waitFor(() => expect(request).toHaveBeenCalledWith(
      "/api/forms/views/view-1",
      expect.objectContaining({
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      }),
    ));
    expect(changed).toHaveBeenCalled();
  });

  it("updates the selected saved view name and current filters", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: "updated" })));
    vi.stubGlobal("fetch", request);
    const changed = vi.fn();
    const edit = vi.fn();
    render(<FormsSavedViews
      views={[{ id: "view-1", name: "Post", queryString: "filter=deliveryMethod%7Eequals%7Epost" }]}
      currentQuery="filter=deliveryMethod%7EisAnyOf%7E%255B%2522post%2522%252C%2522australia_shipping%2522%255D"
      onChanged={changed}
      onOpen={vi.fn()}
      onEdit={edit}
    />);

    fireEvent.click(screen.getByRole("button", { name: "More actions for Post" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit Post" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(edit).toHaveBeenCalledWith("filter=deliveryMethod%7Eequals%7Epost");
    expect(screen.getByLabelText("Saved view name")).toHaveFocus();
    fireEvent.change(screen.getByLabelText("Saved view name"), { target: { value: "Delivery orders" } });
    fireEvent.click(screen.getByRole("button", { name: "Update saved view" }));

    await waitFor(() => expect(request).toHaveBeenCalledWith(
      "/api/forms/views/view-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          name: "Delivery orders",
          queryString: "filter=deliveryMethod%7EisAnyOf%7E%255B%2522post%2522%252C%2522australia_shipping%2522%255D",
        }),
      }),
    ));
    expect(changed).toHaveBeenCalled();
  });
});
