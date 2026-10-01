import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlikFeaturePanel } from "./flik-feature-panel";

const snapshot = {
  status: "disabled", ready: true, canManage: true,
  readiness: [{ code: "credentials", label: "Live credentials", ready: true }],
};
const response = (body: unknown, ok = true) => ({ ok, json: async () => body });
afterEach(() => vi.unstubAllGlobals());

describe("Flik feature controls", () => {
  it("loads safely and never changes availability just by selecting a status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(snapshot));
    vi.stubGlobal("fetch", fetchImpl);
    render(<FlikFeaturePanel />);
    expect(screen.queryByRole("button", { name: "Save availability" })).not.toBeInTheDocument();
    const select = await screen.findByRole("combobox", { name: "Availability" });
    fireEvent.change(select, { target: { value: "internal_verification" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Save availability" })).toBeEnabled();
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: "GET", cache: "no-store" });
  });

  it("requires an explicit owner save and sends the expected status and one idempotency key", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(snapshot)).mockResolvedValueOnce(response({ ...snapshot, status: "internal_verification" }));
    vi.stubGlobal("fetch", fetchImpl);
    render(<FlikFeaturePanel />);
    fireEvent.change(await screen.findByRole("combobox", { name: "Availability" }), { target: { value: "internal_verification" } });
    fireEvent.click(screen.getByRole("button", { name: "Save availability" }));
    await screen.findByText("Availability saved.");
    const request = fetchImpl.mock.calls[1][1];
    expect(request.method).toBe("POST");
    expect(request.headers).toEqual({ "Content-Type": "application/json", Accept: "application/json" });
    expect(JSON.parse(request.body)).toEqual({ status: "internal_verification", expectedStatus: "disabled", idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/i) });
    expect(screen.getByRole("link", { name: "Open verification checkout" })).toHaveAttribute("href", "/checkout");
    expect(screen.getByText(/up to NZ\$100/)).toBeInTheDocument();
  });

  it("shows missing requirements and prevents activation while allowing disable", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response({ ...snapshot, status: "live", ready: false, readiness: [{ code: "webhook", label: "Webhook configuration", ready: false }] }))
      .mockResolvedValueOnce(response({ ...snapshot, ready: false }));
    vi.stubGlobal("fetch", fetchImpl);
    render(<FlikFeaturePanel />);
    const select = await screen.findByRole("combobox", { name: "Availability" });
    expect(screen.getByRole("option", { name: "Internal verification" })).toBeDisabled();
    expect(screen.getByRole("option", { name: "Live" })).toBeDisabled();
    expect(screen.getByText("Webhook configuration")).toBeInTheDocument();
    expect(screen.getByText("Missing")).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "disabled" } });
    expect(screen.getByRole("button", { name: "Save availability" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Save availability" }));
    await screen.findByText("Availability saved.");
  });

  it("gives non-owner administrators read-only readiness", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ...snapshot, canManage: false })));
    render(<FlikFeaturePanel />);
    await screen.findByText("Only the owner can change availability.");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save availability" })).not.toBeInTheDocument();
    expect(screen.getByText("Live credentials")).toBeInTheDocument();
  });

  it("fails closed without exposing a raw error or assuming a saved status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "secret-provider-diagnostic" }, false)));
    render(<FlikFeaturePanel />);
    await screen.findByRole("alert");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("secret-provider-diagnostic");
    expect(screen.getByText(/Controls are disabled until/)).toBeInTheDocument();
  });

  it("retries an uncertain save using the same body and leaves the saved status unchanged until confirmed", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response({ ...snapshot, status: "internal_verification" }))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(response({ ...snapshot, status: "live" }));
    vi.stubGlobal("fetch", fetchImpl);
    render(<FlikFeaturePanel />);
    fireEvent.change(await screen.findByRole("combobox", { name: "Availability" }), { target: { value: "live" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Save availability" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.getByText("Current availability: Internal verification")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    await screen.findByText("Availability saved.");
    expect(fetchImpl.mock.calls[1][1].body).toBe(fetchImpl.mock.calls[2][1].body);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).liveVerificationConfirmed).toBe(true);
    await waitFor(() => expect(screen.getByText("Current availability: Live")).toBeInTheDocument());
  });

  it("requires internal verification and an explicit owner confirmation before saving Live", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(snapshot)).mockResolvedValueOnce(response({ ...snapshot, status: "internal_verification" }));
    vi.stubGlobal("fetch", fetchImpl);
    render(<FlikFeaturePanel />);
    await screen.findByRole("combobox");
    expect(screen.getByRole("option", { name: "Live" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    await screen.findByText("Current availability: Internal verification");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "live" } });
    expect(screen.getByRole("button", { name: "Save availability" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "I have verified the live payment, webhook, order status, NZD amount and duplicate handling." }));
    expect(screen.getByRole("button", { name: "Save availability" })).toBeEnabled();
  });

  it("rejects a malformed activation snapshot", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ...snapshot, ready: "true" })));
    render(<FlikFeaturePanel />);
    await screen.findByRole("alert");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
