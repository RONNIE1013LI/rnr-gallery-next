import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentLedgerPanel } from "./payment-ledger-panel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const summary = {
  orderId: "order-1", orderNumber: "08001", currency: "NZD" as const,
  totalCents: 40_000, netPaidCents: 20_000, outstandingCents: 20_000,
  reservedCents: 5_000, unreservedCents: 15_000,
  ledger: [{
    id: "ledger-1", entryType: "bank_transfer" as const, direction: "credit" as const,
    amountCents: 20_000, currency: "NZD" as const,
    receivedAt: "2026-08-18T05:00:00.000Z", reference: "BANK-1",
    createdAt: "2026-08-18T05:01:00.000Z",
  }],
};

describe("PaymentLedgerPanel", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("crypto", { randomUUID: () => "ledger-idempotency-key" });
  });

  it("shows total, paid, outstanding and reserved balances", () => {
    render(<PaymentLedgerPanel summary={summary} />);
    expect(screen.getByText("NZ$400.00")).toBeInTheDocument();
    expect(screen.getAllByText("NZ$200.00")).toHaveLength(2);
    expect(screen.getByText("NZ$50.00")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create payment request" })).toHaveAttribute(
      "href", "/admin/payment-requests/new?orderId=order-1",
    );
  });

  it("requires a reason before reversing a bank transfer", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ entry: {} }) });
    vi.stubGlobal("fetch", fetchSpy);
    render(<PaymentLedgerPanel summary={summary} />);
    fireEvent.click(screen.getByRole("button", { name: "Reverse bank transfer" }));
    const submit = screen.getByRole("button", { name: "Confirm reversal" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reversal reason"), { target: { value: "Entered on wrong order" } });
    fireEvent.click(submit);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1].body))).toMatchObject({
      action: "reverse", entryId: "ledger-1", reason: "Entered on wrong order",
    });
  });
});
