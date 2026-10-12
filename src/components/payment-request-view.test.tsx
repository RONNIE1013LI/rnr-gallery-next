import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  serverNow: "2026-09-26T00:00:00.000Z",
  expiresAt: "2026-09-26T12:00:00.000Z",
});

describe("PaymentRequestView", () => {
  it("shows payment controls after confirmation without a deadline or countdown", async () => {
    const unlimited = { ...request, expiresAt: undefined };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ request: unlimited }) }));
    render(<PaymentRequestView request={unlimited} methods={[{ method: "afterpay", label: "Afterpay", isTest: false }]} />);
    expect(await screen.findByRole("button", { name: "Pay NZ$200.00" })).toBeInTheDocument();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(screen.queryByText(/12 hours/)).not.toBeInTheDocument();
  });

  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ request }) }));
    window.history.replaceState({}, "", "/pay/A234567890123456789012345678901234567890123");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (window as Window & { google?: unknown }).google;
  });

  it("activates an existing pending request using a JSON POST before rendering its form", async () => {
    const fetchSpy = vi.fn().mockImplementation(async (_url, init) => {
      const valid = init.headers?.["Content-Type"] === "application/json" && init.body === "{}";
      return { ok: valid, status: valid ? 200 : 415, json: async () => valid ? { request } : { error: "Request bodies must use application/json" } };
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<PaymentRequestView request={{ ...request, expiresAt: undefined }} methods={[{ method: "card", label: "Card", isTest: false }]} />);
    expect(await screen.findByLabelText("Full name")).toBeInTheDocument();
    expect(screen.getByText("This payment link has no time limit.")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("stops transient activation retries after three attempts and supports manual retry", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchSpy);
    render(<PaymentRequestView request={request} methods={[]} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText(/Retrying automatically/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contact R&R Gallery" })).toHaveAttribute("href", "/contact");
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ request }) });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    expect(screen.getByText("This payment link has no time limit.")).toBeInTheDocument();
  });

  it("bounds stalled activation requests with a timeout", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("Aborted")));
    }));
    vi.stubGlobal("fetch", fetchSpy);
    render(<PaymentRequestView request={request} methods={[]} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(45000); });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("does not automatically retry permanent activation failures", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchSpy);
    render(<PaymentRequestView request={request} methods={[]} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
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

  it("requires no address for Card and reveals address only for Afterpay", async () => {
    render(<PaymentRequestView request={request} methods={[
      { method: "card", label: "Card", isTest: false },
      { method: "afterpay", label: "Afterpay", isTest: false },
    ]} />);

    expect(screen.queryByLabelText("Street address")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("radio", { name: "Afterpay" }));
    expect(screen.getByLabelText("Street address")).toBeInTheDocument();
    expect(screen.getByLabelText("Country")).toBeInTheDocument();
  });

  it("shows recognisable Card and Afterpay payment marks beside their options", async () => {
    render(<PaymentRequestView request={request} methods={[
      { method: "card", label: "Card", isTest: false },
      { method: "afterpay", label: "Afterpay", isTest: false },
    ]} />);

    await screen.findByLabelText("Full name");
    expect(screen.getByRole("img", {
      name: "Accepted cards: Visa, Mastercard and American Express",
    })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Afterpay" })).toBeInTheDocument();
  });

  it("renders the currency-authoritative country as a full-size read-only field", async () => {
    render(<PaymentRequestView request={request} methods={[
      { method: "afterpay", label: "Afterpay", isTest: false },
    ]} />);

    const country = await screen.findByLabelText("Country");
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
    render(<PaymentRequestForm amountCents={request.amountCents} currency={request.currency} methods={[
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
      expect(screen.getByText(/This payment link has expired|has already been paid/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Pay / })).not.toBeInTheDocument();
    },
  );

  it("formats Australian requests explicitly in AUD", () => {
    render(<PaymentRequestView request={{ ...request, currency: "AUD" }} methods={[
      { method: "card", label: "Card", isTest: false },
    ]} />);
    expect(screen.getAllByText("A$200.00 AUD").length).toBeGreaterThan(0);
  });
  it("waits for successful hydration activation before showing payment controls", async () => {
    let finish!: (value: unknown) => void;
    const fetchSpy = vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetchSpy);
    render(<PaymentRequestView request={{ ...request, expiresAt: undefined }} methods={[{ method: "card", label: "Card", isTest: false }]} />);
    expect(screen.queryByRole("button", { name: /Pay / })).not.toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringMatching(/\/open$/), expect.objectContaining({ method: "POST" }));
    await act(async () => { finish({ ok: true, json: async () => ({ request }) }); });
    expect(screen.getByRole("button", { name: "Pay NZ$200.00" })).toBeInTheDocument();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });

  it("polls paid and removes every payment control without a refresh", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ request }) })
      .mockResolvedValue({ ok: true, json: async () => ({ request: { ...request, status: "paid" } }) });
    vi.stubGlobal("fetch", fetchSpy);
    render(<PaymentRequestView request={request} methods={[{ method: "card", label: "Card", isTest: false }]} />);
    await act(async () => {});
    expect(screen.getByRole("button", { name: /Pay / })).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(screen.getByRole("heading", { name: "Payment completed" })).toBeInTheDocument();
    expect(screen.getByText("No further payment is required.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pay / })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(fetchSpy.mock.calls[1][1]).toMatchObject({ method: "GET" });
  });

  it("keeps an existing pending form available beyond its historical deadline", async () => {
    vi.useFakeTimers();
    const legacy = { ...request, expiresAt: "2026-09-25T00:00:00.000Z" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ request: legacy }) }));
    render(<PaymentRequestView request={legacy} methods={[{ method: "card", label: "Card", isTest: false }]} />);
    await act(async () => {});
    vi.setSystemTime(new Date("2026-10-13T00:00:00.000Z"));
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(screen.getByRole("button", { name: /Pay / })).toBeInTheDocument();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(screen.queryByText("This payment link has expired.")).not.toBeInTheDocument();
  });

  it("continues read-only polling for an expired link until delayed payment is confirmed", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ request: { ...request, status: "expired" } }) })
      .mockResolvedValue({ ok: true, json: async () => ({ request: { ...request, status: "paid" } }) });
    vi.stubGlobal("fetch", fetchSpy);
    render(<PaymentRequestView request={{ ...request, status: "expired" }} methods={[]} />);
    await act(async () => {});
    expect(screen.getByText("This payment link has expired.")).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(screen.getByRole("heading", { name: "Payment completed" })).toBeInTheDocument();
    expect(fetchSpy.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
  });

  it("uses a friendly processing state without offering a duplicate payment", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      payment: { status: "processing", method: "card", isTest: false, canRetry: false }, action: null,
    }) }));
    render(<PaymentRequestForm amountCents={20000} currency="NZD" methods={[{ method: "card", label: "Card", isTest: false }]} />);
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Test Payer" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "payer@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: /Pay / }));
    expect(await screen.findByText(/Payment is being confirmed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pay / })).not.toBeInTheDocument();
  });

});
