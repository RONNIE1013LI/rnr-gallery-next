import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrderVoucherPanel } from "./order-voucher-panel";

afterEach(() => vi.unstubAllGlobals());
const context = { jobId: "job-1", orderNumber: "08087", customerName: "Example customer", customerEmail: "customer@example.test", customerKey: "customer-1", expectedUpdatedAt: "2026-11-02T10:00:00.000Z", canIssue: true };

describe("order voucher panel", () => {
  it("uses saved order context inside a parent form without submitting it", async () => {
    const submit = vi.fn((event) => event.preventDefault());
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => context }).mockResolvedValueOnce({ ok: true, json: async () => ({ code: "THANKYOU-EXAMPLE" }) });
    vi.stubGlobal("fetch", fetch);
    const { container } = render(<form onSubmit={submit}><OrderVoucherPanel jobId="job-1" /></form>);
    const previousOrder = await screen.findByLabelText("Previous order number (5 digits)");
    expect(previousOrder).toHaveValue("08087");
    expect(previousOrder).toHaveAttribute("readonly");
    expect(container.querySelectorAll("form")).toHaveLength(1);
    expect(screen.getByText("customer@example.test")).toBeInTheDocument();
    const generate = screen.getByRole("button", { name: "Generate voucher" });
    expect(generate).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(generate).toBeEnabled();
    fireEvent.keyDown(previousOrder, { key: "Enter", code: "Enter" });
    fireEvent.click(generate);
    expect(await screen.findByLabelText("Voucher code")).toHaveValue("THANKYOU-EXAMPLE");
    expect(submit).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenLastCalledWith("/api/forms/jobs/job-1/voucher", expect.objectContaining({ method: "POST", body: JSON.stringify({ previousOrderNumber: "08087", verified: true, expectedUpdatedAt: context.expectedUpdatedAt }) }));
  });

  it("does not expose generation when no eligible registered account exists", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...context, customerKey: null, canIssue: false, message: "Ask this customer to register first." }) }));
    render(<OrderVoucherPanel jobId="job-1" />);
    expect(await screen.findByText("Ask this customer to register first.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate voucher" })).not.toBeInTheDocument();
  });

  it("shows context and generation rejection without issuing another request", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Save and reopen this order." }) });
    vi.stubGlobal("fetch", fetch);
    render(<OrderVoucherPanel jobId="job-1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Save and reopen this order.");
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });

  it("ignores a previous job response after switching jobs", async () => {
    let resolveOld!: (response: unknown) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValueOnce({ ok: true, json: async () => ({ ...context, jobId: "job-2", orderNumber: "08088" }) });
    vi.stubGlobal("fetch", fetch);
    const { rerender } = render(<OrderVoucherPanel jobId="job-1" />);
    rerender(<OrderVoucherPanel jobId="job-2" />);
    expect(await screen.findByLabelText("Previous order number (5 digits)")).toHaveValue("08088");
    resolveOld({ ok: true, json: async () => context });
    await waitFor(() => expect(screen.getByLabelText("Previous order number (5 digits)")).toHaveValue("08088"));
  });
});
