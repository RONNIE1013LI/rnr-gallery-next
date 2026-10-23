import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WisePayIdPanel } from "./wise-payid-panel";

const snapshot = { enabled: true, autoMatch: true, receipts: [], intents: [], audit: [] };
const response = (body: unknown, ok = true) => ({ ok, json: async () => body });

afterEach(() => vi.unstubAllGlobals());

describe("Wise PayID administrator sync", () => {
  it("immediately rechecks a receipt already confirmed in Wise without selecting an order", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(snapshot))
      .mockResolvedValueOnce(response({ applied: 1, autoMatch: true }))
      .mockResolvedValueOnce(response(snapshot));
    vi.stubGlobal("fetch", fetchImpl);
    render(<WisePayIdPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Confirmed in Wise — sync now" }));

    await screen.findByText("Sync complete. 1 payment was automatically confirmed.");
    const request = fetchImpl.mock.calls[1][1];
    expect(request.method).toBe("POST");
    expect(JSON.parse(request.body)).toEqual({ action: "sync_confirmed_receipt" });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
  });
});
