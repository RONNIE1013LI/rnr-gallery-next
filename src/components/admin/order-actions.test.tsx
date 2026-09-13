import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminOrderActions } from "./order-actions";

vi.mock("@/lib/client-id", () => ({ createClientId: () => "idempotency-key" }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AdminOrderActions tracking", () => {
  it("renders the approved carrier choices and preserves an unknown saved value", () => {
    render(<AdminOrderActions orderId="order-1" currentStatus="new" tracking={{ carrier: "Legacy Carrier", number: "TRACK-1", url: null }} />);

    const section = screen.getByRole("heading", { name: "Shipping / Tracking" }).parentElement?.parentElement;
    expect(section).toBeTruthy();
    const carrier = within(section!).getByLabelText("Carrier");
    expect(carrier).toHaveValue("Legacy Carrier");
    expect(within(carrier).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Select carrier", "Legacy Carrier", "Aramex NZ", "NZ Couriers", "NZ Post", "DHL",
    ]);
  });

  it("submits selected tracking values through the existing order action", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: "updated" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("location", { reload: vi.fn() });
    render(<AdminOrderActions orderId="order-1" currentStatus="new" tracking={{ carrier: null, number: null, url: null }} />);

    fireEvent.change(screen.getByLabelText("Carrier"), { target: { value: "DHL" } });
    fireEvent.change(screen.getByLabelText("Tracking number"), { target: { value: "TRACK-2" } });
    fireEvent.change(screen.getByLabelText("Tracking URL (HTTPS)"), { target: { value: "https://dhl.example/track" } });
    fireEvent.click(screen.getByRole("button", { name: "Save tracking" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(payload).toMatchObject({ action: "set_tracking", carrier: "DHL", trackingNumber: "TRACK-2", trackingUrl: "https://dhl.example/track" });
  });
});
