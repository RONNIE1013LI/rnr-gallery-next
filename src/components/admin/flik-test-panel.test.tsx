import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlikTestPanel } from "./flik-test-panel";
const id = "10000000-0000-4000-8000-000000000001";
const json = (session: unknown) => ({ ok: true, json: async () => ({ session }) });
afterEach(() => vi.unstubAllGlobals());
describe("Flik isolated test panel", () => {
  it("cannot initiate payments when disabled even with return parameters", () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    render(<FlikTestPanel enabled={false} initialSessionId={id} />);
    expect(screen.getByRole("button", { name: "Start NZ$1.00 test" })).toBeDisabled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("confirms a returned session with POST and never assumes success from the URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ id, status: "pending" }));
    vi.stubGlobal("fetch", fetchImpl);
    render(<FlikTestPanel enabled initialSessionId={id} />);
    await screen.findByText(/Payment is awaiting confirmation/);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ action: "confirm", sessionId: id });
    expect(fetchImpl.mock.calls[0][1].method).toBe("POST");
    expect(screen.queryByText(/Test payment confirmed/)).not.toBeInTheDocument();
  });
  it("recovers ambiguous creation with the same idempotency key", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => id });
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ id, status: "pending" })).mockResolvedValueOnce(json({ id, status: "created", redirectUrl: "https://app.flik.co.nz/checkout/s/test" }));
    vi.stubGlobal("fetch", fetchImpl);
    render(<FlikTestPanel enabled />);
    fireEvent.click(screen.getByRole("button", { name: "Start NZ$1.00 test" }));
    fireEvent.click(await screen.findByRole("button", { name: "Recover test session" }));
    await screen.findByRole("link", { name: "Continue to Flik test checkout" });
    expect(fetchImpl.mock.calls.map((call) => JSON.parse(call[1].body))).toEqual([{ action: "create", idempotencyKey: id }, { action: "create", idempotencyKey: id }]);
  });
  it("does not expose another payment link after a confirmed test", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ id, status: "completed" }));
    vi.stubGlobal("fetch", fetchImpl);
    render(<FlikTestPanel enabled initialSessionId={id} />);
    await screen.findByText(/Test payment confirmed/);
    await waitFor(() => expect(screen.getByRole("button", { name: "Start NZ$1.00 test" })).toBeEnabled());
    expect(screen.queryByRole("link", { name: /Continue to Flik/ })).not.toBeInTheDocument();
  });
});
