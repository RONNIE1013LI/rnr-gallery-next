import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicPaymentRequestDTO } from "@/server/payment-requests/types";
import { PaymentRequestForm } from "./payment-request-form";
import { PaymentRequestView } from "./payment-request-view";

const request: PublicPaymentRequestDTO = Object.freeze({
  requestNumber: "PAY-2026-ABC123",
  kind: "standalone",
  description: "Outstanding design balance",
  amountCents: 20_000,
  currency: "NZD",
  status: "pending",
  methods: ["card", "afterpay"] as const,
});

describe("PaymentRequestView", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/pay/A234567890123456789012345678901234567890123");
  });

  afterEach(() => {
    delete (window as Window & { google?: unknown }).google;
  });

  it("shows only the public fixed-payment details and does not expose editable amount controls", () => {
    render(<PaymentRequestView request={request} methods={[
      { method: "card", label: "Card", isTest: false },
      { method: "afterpay", label: "Afterpay", isTest: false },
    ]} />);

    expect(screen.getByRole("heading", { name: "Payment request" })).toBeInTheDocument();
    expect(screen.getByText("PAY-2026-ABC123")).toBeInTheDocument();
    expect(screen.getByText("Outstanding design balance")).toBeInTheDocument();
    expect(screen.getByText("NZ$200.00")).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.queryByText(/customer/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /zip/i })).not.toBeInTheDocument();
  });

  it("requires no address for Card and reveals address only for Afterpay", () => {
    render(<PaymentRequestView request={request} methods={[
      { method: "card", label: "Card", isTest: false },
      { method: "afterpay", label: "Afterpay", isTest: false },
    ]} />);

    expect(screen.queryByLabelText("Street address")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Afterpay" }));
    expect(screen.getByLabelText("Street address")).toBeInTheDocument();
    expect(screen.getByLabelText("Country")).toBeInTheDocument();
  });

  it("shows recognisable Card and Afterpay payment marks beside their options", () => {
    render(<PaymentRequestView request={request} methods={[
      { method: "card", label: "Card", isTest: false },
      { method: "afterpay", label: "Afterpay", isTest: false },
    ]} />);

    expect(screen.getByRole("img", {
      name: "Accepted cards: Visa, Mastercard and American Express",
    })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Afterpay" })).toBeInTheDocument();
  });

  it("renders the currency-authoritative country as a full-size read-only field", () => {
    render(<PaymentRequestView request={request} methods={[
      { method: "afterpay", label: "Afterpay", isTest: false },
    ]} />);

    const country = screen.getByLabelText("Country");
    expect(country.tagName).toBe("INPUT");
    expect(country).toHaveAttribute("readonly");
    expect(country).toHaveValue("New Zealand");
    expect(getComputedStyle(country).minHeight).toBe("48px");
    expect(getComputedStyle(country).backgroundColor).toBe("rgb(244, 241, 234)");
  });

  it("uses Google address suggestions to fill the Afterpay address", async () => {
    const place = {
      addressComponents: [
        { longText: "11", shortText: "11", types: ["street_number"] },
        { longText: "Para Close", shortText: "Para Close", types: ["route"] },
        { longText: "Fairview Heights", shortText: "Fairview Heights", types: ["sublocality_level_1"] },
        { longText: "Auckland", shortText: "Auckland", types: ["locality"] },
        { longText: "0632", shortText: "0632", types: ["postal_code"] },
        { longText: "New Zealand", shortText: "NZ", types: ["country"] },
      ],
      fetchFields: vi.fn().mockResolvedValue(undefined),
    };
    const fetchAutocompleteSuggestions = vi.fn().mockResolvedValue({
      suggestions: [{
        placePrediction: {
          text: { toString: () => "11 Para Close, Fairview Heights, Auckland" },
          toPlace: () => place,
        },
      }],
    });
    (window as Window & { google?: unknown }).google = {
      maps: {
        importLibrary: vi.fn().mockResolvedValue({
          AutocompleteSessionToken: function AutocompleteSessionToken() {},
          AutocompleteSuggestion: { fetchAutocompleteSuggestions },
        }),
      },
    };

    render(<PaymentRequestForm
      amountCents={1_000}
      currency="NZD"
      googleMapsApiKey="test-browser-key"
      methods={[{ method: "afterpay", label: "Afterpay", isTest: false }]}
    />);

    fireEvent.change(screen.getByLabelText("Street address"), {
      target: { value: "11 Para" },
    });
    fireEvent.click(await screen.findByRole("option", {
      name: "11 Para Close, Fairview Heights, Auckland",
    }));

    await waitFor(() => expect(screen.getByLabelText("Street address")).toHaveValue("11 Para Close"));
    expect(screen.getByLabelText("Suburb")).toHaveValue("Fairview Heights");
    expect(screen.getByLabelText("Region")).toHaveValue("Auckland");
    expect(screen.getByLabelText("Postcode")).toHaveValue("0632");
    expect(fetchAutocompleteSuggestions).toHaveBeenCalledWith(expect.objectContaining({
      includedRegionCodes: ["nz"],
      input: "11 Para",
      language: "en-NZ",
      region: "nz",
    }));
  });

  it("submits payer details without an amount or raw token in the JSON body", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        payment: { method: "card", status: "processing", isTest: false, canRetry: false },
        action: { kind: "redirect", method: "card", redirectUrl: "https://payments.example.test/session" },
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, pathname: "/pay/A234567890123456789012345678901234567890123", assign },
    });
    render(<PaymentRequestView request={request} methods={[
      { method: "card", label: "Card", isTest: false },
    ]} />);

    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Test Payer" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "payer@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Pay NZ$200.00" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ method: "card", fullName: "Test Payer", email: "payer@example.test" });
    expect(body).not.toHaveProperty("amountCents");
    expect(body).not.toHaveProperty("token");
  });

  it.each(["paid", "expired", "cancelled", "invalidated"] as const)(
    "shows no payment controls when status is %s",
    (status) => {
      render(<PaymentRequestView request={{ ...request, status }} methods={[]} />);
      expect(screen.getByText(/no longer payable|has been paid/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Pay / })).not.toBeInTheDocument();
    },
  );

  it("formats Australian requests explicitly in AUD", () => {
    render(<PaymentRequestView request={{ ...request, currency: "AUD" }} methods={[
      { method: "card", label: "Card", isTest: false },
    ]} />);
    expect(screen.getAllByText("A$200.00 AUD").length).toBeGreaterThan(0);
  });
});
