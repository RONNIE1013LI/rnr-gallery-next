import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FormsSavedViews } from "./forms-saved-views";

afterEach(() => vi.unstubAllGlobals());

describe("forms saved views", () => {
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
});
