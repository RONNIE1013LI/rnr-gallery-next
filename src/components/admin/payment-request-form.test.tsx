import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentRequestForm } from "./payment-request-form";

describe("Admin PaymentRequestForm", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("crypto", { randomUUID: () => "admin-idempotency-key" });
  });

  it("renders on the server without a browser window", () => {
    vi.stubGlobal("window", undefined);

    expect(() => renderToStaticMarkup(<PaymentRequestForm />)).not.toThrow();
  });

  it("uses the linked Order currency and defaults to its unreserved balance", () => {
    render(<PaymentRequestForm linkedOrder={{
      id: "order-1", orderNumber: "08001", currency: "NZD", unreservedCents: 15_000,
    }} />);
    expect(screen.getByText("Order 08001")).toBeInTheDocument();
    expect(screen.getByLabelText("Currency")).toHaveValue("NZD");
    expect(screen.getByLabelText("Currency")).toBeDisabled();
    expect(screen.getByLabelText("Amount")).toHaveValue(150);
    expect(screen.getByRole("checkbox", { name: "Card" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Afterpay" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /zip/i })).not.toBeInTheDocument();
  });

  it("keeps standalone name and email optional and reveals the one-time link", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        request: { id: "request-1", requestNumber: "PAY-2026-ABC" },
        paymentUrl: "https://rrgallery.co.nz/pay/safe-token",
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<PaymentRequestForm />);

    expect(screen.getByLabelText("Customer name (optional)")).not.toBeRequired();
    expect(screen.getByLabelText("Customer email (optional)")).not.toBeRequired();
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Custom balance" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "Create payment request" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("https://rrgallery.co.nz/pay/safe-token")).toBeInTheDocument();
    expect(screen.getByText(/shown only once/i)).toBeInTheDocument();
  });

  it("allows the initial zero to be cleared and submits exact cents", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ request: { id: "request-1" } }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<PaymentRequestForm />);

    const amount = screen.getByLabelText("Amount");
    fireEvent.change(amount, { target: { value: "" } });
    expect(amount).toHaveValue(null);
    fireEvent.change(amount, { target: { value: "200.25" } });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Outstanding balance" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create payment request" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toMatchObject({ amountCents: 20_025 });
  });

  it("does not submit an empty amount", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<PaymentRequestForm />);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Create payment request" }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a standalone amount above the advertised maximum before sending a request", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<PaymentRequestForm />);

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1000000.01" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Large balance" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create payment request" }).closest("form")!);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a valid amount with no more than two decimal places.")).toBeInTheDocument();
  });

  it("submits the standalone maximum as exact cents", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ request: { id: "request-1" } }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<PaymentRequestForm />);

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1000000" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Maximum balance" } });
    fireEvent.click(screen.getByRole("button", { name: "Create payment request" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toMatchObject({ amountCents: 100_000_000 });
  });

  it("submits exact cents for a valid seven-cent amount", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ request: { id: "request-1" } }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<PaymentRequestForm />);

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "0.07" } });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Small balance" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create payment request" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toMatchObject({ amountCents: 7 });
  });
});
