import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FormsInlineCell } from "./forms-inline-cell";

afterEach(() => vi.unstubAllGlobals());

describe("forms inline cell", () => {
  it("autosaves a changed boolean selection without confirmation controls", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: "updated",
      version: "2026-08-05T02:00:00.000Z",
    }), { status: 200 }));
    vi.stubGlobal("fetch", request);

    render(<FormsInlineCell
      jobId="job-1" reference="07188" field="printed" label="Printed"
      value={false} version="2026-08-05T01:00:00.000Z" kind="boolean"
      onSaved={vi.fn()}
    >NO</FormsInlineCell>);

    fireEvent.click(screen.getByRole("button", { name: "Edit Printed for 07188" }));
    expect(screen.queryByRole("button", { name: "Save Printed" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel Printed" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Printed for 07188"), { target: { value: "true" } });

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    const body = JSON.parse(String(vi.mocked(request).mock.calls[0][1]?.body));
    expect(body).toMatchObject({ field: "printed", value: true });
  });

  it("keeps the editor at the original visible field width", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, top: 0, right: 58, bottom: 24, left: 0,
      width: 58, height: 24, toJSON: () => ({}),
    });
    render(<FormsInlineCell
      jobId="job-1" reference="07188" field="printed" label="Printed"
      value={false} version="2026-08-05T01:00:00.000Z" kind="boolean"
      onSaved={vi.fn()}
    >NO</FormsInlineCell>);

    fireEvent.click(screen.getByRole("button", { name: "Edit Printed for 07188" }));

    expect(screen.getByLabelText("Printed for 07188").parentElement).toHaveStyle({ width: "58px" });
  });

  it("keeps a manual editor at the original visible field width", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, top: 0, right: 74, bottom: 24, left: 0,
      width: 74, height: 24, toJSON: () => ({}),
    });
    render(<FormsInlineCell
      jobId="job-1" reference="07188" field="amountPaid" label="AmtPaid"
      value={13000} version="2026-08-05T01:00:00.000Z" kind="money"
      onSaved={vi.fn()}
    >$130.00</FormsInlineCell>);

    fireEvent.click(screen.getByRole("button", { name: "Edit AmtPaid for 07188" }));

    expect(screen.getByLabelText("AmtPaid for 07188").parentElement).toHaveStyle({ width: "74px" });
  });

  it("autosaves the selected option value and ignores an unchanged selection", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: "updated" }), { status: 200 }));
    vi.stubGlobal("fetch", request);
    const props = {
      jobId: "job-1",
      reference: "07188",
      field: "deliveryMethod" as const,
      label: "Delivery",
      value: "post",
      version: "2026-08-05T01:00:00.000Z",
      kind: "select" as const,
      options: [
        { value: "post", label: "Post" },
        { value: "pickup", label: "Pick up" },
      ],
      onSaved: vi.fn(),
    };

    const { rerender } = render(<FormsInlineCell {...props}>Post</FormsInlineCell>);
    fireEvent.click(screen.getByRole("button", { name: "Edit Delivery for 07188" }));
    fireEvent.change(screen.getByLabelText("Delivery for 07188"), { target: { value: "post" } });
    expect(request).not.toHaveBeenCalled();

    rerender(<FormsInlineCell {...props}>Post</FormsInlineCell>);
    fireEvent.click(screen.getByRole("button", { name: "Edit Delivery for 07188" }));
    fireEvent.change(screen.getByLabelText("Delivery for 07188"), { target: { value: "pickup" } });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(vi.mocked(request).mock.calls[0][1]?.body));
    expect(body).toMatchObject({ field: "deliveryMethod", value: "pickup" });
  });

  it("restores a dropdown after an automatic save fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "The value could not be saved.",
    }), { status: 500 })));

    render(<FormsInlineCell
      jobId="job-1" reference="07188" field="printed" label="Printed"
      value={false} version="2026-08-05T01:00:00.000Z" kind="boolean"
      onSaved={vi.fn()}
    >NO</FormsInlineCell>);

    fireEvent.click(screen.getByRole("button", { name: "Edit Printed for 07188" }));
    fireEvent.change(screen.getByLabelText("Printed for 07188"), { target: { value: "true" } });

    expect(await screen.findByText("The value could not be saved.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Printed for 07188" })).toHaveTextContent("NO");
  });

  it("saves a typed inline value with optimistic concurrency metadata", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: "updated", version: "2026-08-05T02:00:00.000Z" }), { status: 200 }));
    vi.stubGlobal("fetch", request);
    const saved = vi.fn();
    render(<FormsInlineCell
      jobId="job-1" reference="07188" field="neededDate" label="DlvryDate"
      value="2026-08-12" version="2026-08-05T01:00:00.000Z" kind="date"
      onSaved={saved}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Edit DlvryDate for 07188" }));
    fireEvent.change(screen.getByLabelText("DlvryDate for 07188"), { target: { value: "2026-08-14" } });
    fireEvent.click(screen.getByRole("button", { name: "Save DlvryDate" }));
    await waitFor(() => expect(request).toHaveBeenCalled());
    const body = JSON.parse(String(vi.mocked(request).mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      field: "neededDate", value: "2026-08-14", expectedUpdatedAt: "2026-08-05T01:00:00.000Z",
    });
    expect(body.idempotencyKey).toEqual(expect.any(String));
    expect(saved).toHaveBeenCalledWith("2026-08-05T02:00:00.000Z");
  });

  it("restores the visible value and offers reload after a 409 conflict", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "The job changed" }), { status: 409 })));
    const reload = vi.fn();
    render(<FormsInlineCell
      jobId="job-1" reference="07188" field="remark" label="Remark"
      value="Original" version="2026-08-05T01:00:00.000Z" kind="text"
      onSaved={vi.fn()} onReload={reload}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Remark for 07188" }));
    fireEvent.change(screen.getByLabelText("Remark for 07188"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Remark" }));
    expect(await screen.findByRole("button", { name: "Reload row" })).toBeInTheDocument();
    expect(screen.getByText("Original")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reload row" }));
    expect(reload).toHaveBeenCalled();
  });
});
