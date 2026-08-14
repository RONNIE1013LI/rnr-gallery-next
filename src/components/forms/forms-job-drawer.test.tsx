import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FormsJobDrawer } from "./forms-job-drawer";

vi.mock("@/components/admin/production-job-detail", () => ({
  ProductionJobDetail: ({ files, notifications, assignees }: { files: unknown[]; notifications: unknown[]; assignees: unknown[] }) => <div data-testid="drawer-detail" data-files={files.length} data-notifications={notifications.length} data-assignees={assignees.length}><label>Internal notes<input aria-label="Internal notes" defaultValue="" /></label></div>,
}));

const detail = {
  job: {
    id: "job-1", jobNumber: "07188", createdAt: "2026-08-05T00:00:00.000Z", updatedAt: "2026-08-05T00:00:00.000Z",
    fileSentAt: null, downloadedAt: null, printedAt: null, customerNotifiedAt: null,
    deliveredAt: null, artistPaidAt: null, completedAt: null,
  },
  items: [], audit: [], finance: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FormsJobDrawer", () => {
  it("loads the scoped detail, offers a full-page fallback and closes with Escape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail, files: [{ id: "file-1" }], notifications: [{ fileId: "file-1" }], assignees: [{ id: "artist-1" }] }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const onClose = vi.fn();
    render(<FormsJobDrawer jobId="job-1" onClose={onClose} assignees={[]} canManageFinance={false} />);
    expect(await screen.findByRole("dialog", { name: "Order 07188" })).toBeInTheDocument();
    expect(screen.getByTestId("drawer-detail")).toHaveAttribute("data-files", "1");
    expect(screen.getByTestId("drawer-detail")).toHaveAttribute("data-notifications", "1");
    expect(screen.getByTestId("drawer-detail")).toHaveAttribute("data-assignees", "1");
    expect(screen.getByRole("link", { name: "Open full editor" })).toHaveAttribute("href", "/order-system/jobs/job-1");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("requires confirmation before closing after an editor value changes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const onClose = vi.fn();
    render(<FormsJobDrawer jobId="job-1" onClose={onClose} assignees={[]} canManageFinance={false} />);
    fireEvent.change(await screen.findByLabelText("Internal notes"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Close order editor" }));
    expect(confirm).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Close order editor" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("contains focus, isolates the background and restores the invoking control", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail }), { status: 200, headers: { "Content-Type": "application/json" } })));

    function Harness() {
      const [open, setOpen] = useState(false);
      return <div>
        <button type="button" onClick={() => setOpen(true)}>Open order</button>
        <button type="button">Background action</button>
        {open ? <FormsJobDrawer jobId="job-1" onClose={() => setOpen(false)} assignees={[]} canManageFinance={false} /> : null}
      </div>;
    }

    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open order" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "Order 07188" });
    const close = screen.getByRole("button", { name: "Close order editor" });
    await waitFor(() => expect(close).toHaveFocus());
    const backgroundAction = screen.getByText("Background action").closest("button");
    expect(backgroundAction).toHaveProperty("inert", true);
    expect(document.body.style.overflow).toBe("hidden");

    const focusable = dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(first).toHaveFocus();
    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
    expect(backgroundAction?.inert).not.toBe(true);
  });
});
