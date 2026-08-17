import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CART_STORAGE_KEY, type Cart } from "@/domain/cart/types";
import { canonicalCheckoutCart, CheckoutView } from "./checkout-view";

const push = vi.fn();
const analytics = vi.hoisted(() => ({
  emitAnalyticsEvent: vi.fn<(event: unknown) => boolean>(() => true),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/domain/analytics/client", () => analytics);
vi.mock("./stripe-payment-form", () => ({
  StripePaymentForm: ({ clientSecret, returnUrl, onPaymentSubmitted, onPaymentUpdated }: {
    clientSecret: string;
    returnUrl: string;
    onPaymentSubmitted?: () => void;
    onPaymentUpdated: (status: "paid" | "failed" | "cancelled" | "processing") => void;
  }) => (
    <div
      data-testid="checkout-stripe-payment-form"
      data-client-secret={clientSecret}
      data-entry-scroll-y={window.scrollY}
      data-return-url={returnUrl}
    >
      <button type="button" onClick={() => onPaymentSubmitted?.()}>Simulate Stripe submit</button>
      <button type="button" onClick={() => onPaymentUpdated("paid")}>Simulate Stripe paid</button>
    </div>
  ),
}));

const cart: Cart = { version: 1, items: [{
  id: "30000000-0000-4000-8000-000000000001", productKey: "photo-print-canvas",
  productSlug: "photo-print-canvas", productTitle: "Browser title", imageSrc: "/test.jpg",
  sizeKey: "a4", sizeLabel: "Browser size", orientation: "landscape", peoplePets: 0,
  photoSubmissionMethod: "later", designText: "Family", notes: "", neededDate: "2026-08-10",
  urgentServiceConfirmed: false, deliveryPreference: "pickup", quantity: 1,
  price: { lines: [], subtotalExGstCents: 1, gstCents: 1, totalInclGstCents: 2 }, uploadReferences: [],
}] };
const postCart: Cart = {
  ...cart,
  items: cart.items.map((item) => ({ ...item, deliveryPreference: "post" as const })),
};
const address = { id: "saved-1", country: "NZ" as const, fullName: "Aroha Ngata", building: "", street: "12 Queen Street", suburb: "Auckland Central", region: "Auckland", postcode: "1010", phone: "+64211234567", email: "aroha@example.test" };
const repriced = { version: 1, market: "NZ", currency: "NZD", taxJurisdiction: "NZ_GST", taxRateBasisPoints: 1500, priceBookRevision: 1, orderDate: "2026-08-03", items: [{ clientItemId: cart.items[0].id, productKey: "photo-print-canvas", productSlug: "photo-print-canvas", productTitle: "Photo Print Canvas", sizeKey: "a4", sizeLabel: "A4", orientation: "landscape", peoplePets: 0, photoSubmissionMethod: "later", designText: "Family", notes: "", neededDate: "2026-08-10", urgentServiceConfirmed: false, urgentService: { workingDays: 5, feeInclGstCents: 0 }, quantity: 1, uploadReferences: [], unitPrice: { lines: [], subtotalExGstCents: 6500, gstCents: 975, totalInclGstCents: 7475 }, lineSubtotalExGstCents: 6500, lineGstCents: 975, lineTotalInclGstCents: 7475 }], subtotalExGstCents: 6500, gstCents: 975, totalInclGstCents: 7475, discountCents: 0, designSurchargeCents: 0, itemCount: 1, cartDigest: "a".repeat(64) };
const paymentIntentStorageKey = "rnr:commerce:v1:guest:checkout:payment-intent";
const checkoutDraftStorageKey = "rnr:commerce:v1:guest:checkout:draft";
const pendingCheckoutStorageKey = "rnr:commerce:v1:guest:checkout:pending";
const methodsResponse = { ok: true, json: async () => ({ methods: [{ method: "card", label: "Test card — no real payment", isTest: true }] }) };
const paymentResponse = { ok: true, json: async () => ({ payment: { method: "card", status: "processing", isTest: true, canRetry: false }, action: null }) };
function placementIntent(orderIdempotencyKey = "70000000-0000-4000-8000-000000000001") { return { schemaVersion: 1, phase: "placing_order", orderIdempotencyKey, paymentIdempotencyKey: orderIdempotencyKey.replace(/^7/, "8"), method: "card", checkoutVersion: 2, cartDigest: "a".repeat(64), shipping: { method: "pickup", serviceCode: "pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, isTest: false } }; }
async function checkoutReady() { return screen.findByRole("button", { name: "Review delivery & totals" }); }

describe("CheckoutView", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    push.mockReset();
    vi.restoreAllMocks();
    analytics.emitAnalyticsEvent.mockReset();
    analytics.emitAnalyticsEvent.mockReturnValue(true);
  });

  it("tracks begin_checkout once for the mounted identity-scoped cart", async () => {
    const view = render(<CheckoutView savedAddresses={[address]} />);
    await checkoutReady();
    view.rerender(<CheckoutView savedAddresses={[address]} />);

    await waitFor(() => expect(analytics.emitAnalyticsEvent).toHaveBeenCalledTimes(1));
    expect(analytics.emitAnalyticsEvent).toHaveBeenCalledWith({
      event: "begin_checkout",
      currency: "NZD",
      value: 0.01,
      items: [{
        item_id: "photo-print-canvas",
        item_name: "Browser title",
        item_variant: "a4",
        price: 0.01,
        quantity: 1,
      }],
    });
    expect(JSON.stringify(analytics.emitAnalyticsEvent.mock.calls))
      .not.toContain(CART_STORAGE_KEY);
  });

  it("tracks shipping only after every review API accepts the repriced cart", async () => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(postCart));
    const repricedAud = { ...repriced, market: "AU", currency: "AUD", taxJurisdiction: "NONE", taxRateBasisPoints: 0 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 2, cart: repricedAud } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shipping: { option: { method: "post", serviceCode: "public-code", serviceName: "Tracked courier", amountExGstCents: 2000, gstCents: 0, amountInclGstCents: 2000, currency: "AUD", provenance: "gosweetspot", isTest: false } } }) })
      .mockResolvedValueOnce(methodsResponse);
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);
    await checkoutReady();

    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));

    await waitFor(() => expect(analytics.emitAnalyticsEvent).toHaveBeenCalledWith({
      event: "add_shipping_info",
      currency: "AUD",
      value: 65,
      shipping_tier: "Tracked courier",
      items: [{
        item_id: "photo-print-canvas",
        item_name: "Photo Print Canvas",
        item_variant: "a4",
        price: 65,
        quantity: 1,
      }],
    }));
    const shippingEvent = analytics.emitAnalyticsEvent.mock.calls
      .map(([event]) => event)
      .find((event) => (event as { event?: string }).event === "add_shipping_info");
    expect(JSON.stringify(shippingEvent)).not.toMatch(/address|email|phone|serviceCode|provenance/i);
  });

  it("does not track shipping or payment information when review fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 2, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shipping: { option: { method: "pickup", serviceCode: "pickup", serviceName: "Pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, currency: "NZD", provenance: "internal", isTest: false } } }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: { message: "Payment methods unavailable" } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);
    await checkoutReady();

    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    await screen.findByText("Payment methods unavailable");

    expect(analytics.emitAnalyticsEvent.mock.calls
      .map(([event]) => (event as { event?: string }).event))
      .toEqual(["begin_checkout"]);
  });

  it("inherits the cart delivery choice without asking the customer to select it again", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 2, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shipping: { option: { method: "pickup", serviceCode: "pickup", serviceName: "Pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, currency: "NZD", provenance: "internal", isTest: false } } }) })
      .mockResolvedValueOnce(methodsResponse);
    vi.stubGlobal("fetch", fetchMock);

    render(<CheckoutView savedAddresses={[address]} />);
    await checkoutReady();

    expect(screen.queryByRole("radiogroup", { name: "Delivery" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Delivery" })).not.toBeInTheDocument();
    expect(screen.queryByText("Selected with your order.", { exact: false })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    await screen.findByText(/No shipping charge/);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).deliveryMethod).toBe("pickup");
  });

  it("builds a canonical request without browser pricing or labels", () => {
    const galleryDesignId = "a".repeat(64);
    const input = canonicalCheckoutCart({
      ...cart,
      items: [{ ...cart.items[0], galleryDesignId }],
    });
    expect(input.items[0]).toMatchObject({ clientItemId: cart.items[0].id, productKey: "photo-print-canvas", sizeKey: "a4", quantity: 1 });
    expect(input.items[0].galleryDesignId).toBe(galleryDesignId);
    expect(JSON.stringify(input)).not.toMatch(/Browser title|Browser size|subtotalExGstCents|totalInclGstCents|price/);
  });

  it("keeps checkout controls locked until the client recovery check finishes", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);

    expect(screen.getByRole("button", { name: "Checking order status…" })).toBeDisabled();
    expect(screen.getByLabelText("Street address")).toBeDisabled();
    expect(screen.queryByRole("radiogroup", { name: "Delivery" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Delivery" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    const reviewButton = await screen.findByRole("button", { name: "Review delivery & totals" });
    expect(reviewButton).toBeEnabled();
    expect(reviewButton.className).toContain("checkoutReviewButton");
  });

  it("replaces a malformed stored payment intent before a new order is placed", async () => {
    sessionStorage.setItem(paymentIntentStorageKey, JSON.stringify({ phase: "placing_order", orderIdempotencyKey: "not-a-uuid" }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 2, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shipping: { option: { method: "pickup", serviceCode: "pickup", serviceName: "Pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, currency: "NZD", provenance: "internal", isTest: false } } }) })
      .mockResolvedValueOnce(methodsResponse)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ order: { orderNumber: "RNR-2026-FRESH" } }) })
      .mockResolvedValueOnce(paymentResponse);
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);

    await checkoutReady();
    expect(sessionStorage.getItem(paymentIntentStorageKey)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    await screen.findByText(/No shipping charge/);
    fireEvent.click(screen.getByRole("button", { name: /Continue to/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/RNR-2026-FRESH#payment"));
    const freshKey = JSON.parse(fetchMock.mock.calls[3][1].body).idempotencyKey;
    expect(freshKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(JSON.parse(sessionStorage.getItem(paymentIntentStorageKey)!)).toMatchObject({
      phase: "starting_payment", orderNumber: "RNR-2026-FRESH",
    });
  });

  it("prefills a saved address, inherits Post, reviews server totals and retains pending payment recovery", async () => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(postCart));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 2, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shipping: { option: { method: "post", serviceCode: "post", serviceName: "Live Post", amountExGstCents: 2000, gstCents: 300, amountInclGstCents: 2300, currency: "NZD", provenance: "gosweetspot", isTest: false } } }) })
      .mockResolvedValueOnce(methodsResponse)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 3, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shipping: { option: { method: "post", serviceCode: "post", serviceName: "Live Post", amountExGstCents: 2000, gstCents: 300, amountInclGstCents: 2300, currency: "NZD", provenance: "gosweetspot", isTest: false } } }) })
      .mockResolvedValueOnce(methodsResponse)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ order: { orderNumber: "RNR-2026-ABC", totalInclGstCents: 9775 } }) })
      .mockResolvedValueOnce(paymentResponse);
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);

    expect(screen.getByLabelText("Full name")).toHaveValue("Aroha Ngata");
    expect(screen.queryByRole("heading", { name: "Delivery" })).not.toBeInTheDocument();
    await checkoutReady();
    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    await screen.findByText("NZ$97.75");
    expect(screen.getByText("NZ$74.75")).toBeInTheDocument();
    expect(screen.getByText("Shipping incl GST")).toBeInTheDocument();
    expect(screen.getByText(/Live carrier rate/)).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/checkout/session");
    const sessionBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sessionBody.deliveryMethod).toBe("post");
    expect(JSON.stringify(sessionBody)).not.toContain("saved-1");

    fireEvent.change(screen.getByLabelText("Street address"), { target: { value: "14 Queen Street" } });
    expect(screen.getByText("Changes need review.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue to/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Street address"), { target: { value: "12 Queen Street" } });
    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    await screen.findByRole("radiogroup", { name: "Payment method" });

    const placeOrder = screen.getByRole("button", { name: "Continue to secure card payment" });
    fireEvent.click(placeOrder);
    fireEvent.click(placeOrder);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/RNR-2026-ABC#payment"));
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(JSON.parse(fetchMock.mock.calls[6][1].body)).toMatchObject({
      checkoutVersion: 3,
      cartDigest: "a".repeat(64),
      shipping: { method: "post", serviceCode: "post", amountInclGstCents: 2300 },
    });
    expect(localStorage.getItem(CART_STORAGE_KEY)).toBe(JSON.stringify(postCart));
    expect(JSON.parse(sessionStorage.getItem(paymentIntentStorageKey)!)).toMatchObject({
      phase: "starting_payment", orderNumber: "RNR-2026-ABC",
    });
  });

  it("keeps the cart and idempotency key when order creation fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 2, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shipping: { option: { method: "pickup", serviceCode: "pickup", serviceName: "Pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, currency: "NZD", provenance: "internal", isTest: false } } }) })
      .mockResolvedValueOnce(methodsResponse)
      .mockResolvedValue({ ok: false, json: async () => ({ error: { message: "Try again" } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);
    await checkoutReady();
    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    expect(await screen.findAllByText("NZ$74.75")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Continue to/ }));
    await screen.findByText("Try again");
    fireEvent.click(screen.getByRole("button", { name: "Retry order recovery" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    const firstKey = JSON.parse(fetchMock.mock.calls[3][1].body).idempotencyKey;
    const secondKey = JSON.parse(fetchMock.mock.calls[4][1].body).idempotencyKey;
    expect(secondKey).toBe(firstKey);
    expect(JSON.parse(sessionStorage.getItem(paymentIntentStorageKey)!).orderIdempotencyKey).toBe(firstKey);
    expect(localStorage.getItem(CART_STORAGE_KEY)).not.toBeNull();
  });

  it("restores the cart if payment creation fails after order creation", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 2, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shipping: { option: { method: "pickup", serviceCode: "pickup", serviceName: "Pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, currency: "NZD", provenance: "internal", isTest: false } } }) })
      .mockResolvedValueOnce(methodsResponse)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ order: { orderNumber: "RNR-2026-PAYFAIL" } }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: { message: "Could not start payment" } }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<CheckoutView savedAddresses={[address]} />);
    await checkoutReady();
    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    await screen.findByText(/No shipping charge/);
    fireEvent.click(screen.getByRole("button", { name: /Continue to/ }));
    await screen.findByText("Could not start payment");

    expect(localStorage.getItem(CART_STORAGE_KEY)).toBe(JSON.stringify(cart));
    expect(screen.queryByRole("heading", { level: 2, name: "Your cart is empty" })).not.toBeInTheDocument();
    const starting = JSON.parse(sessionStorage.getItem(paymentIntentStorageKey)!);
    expect(starting).toMatchObject({
      phase: "starting_payment",
      orderNumber: "RNR-2026-PAYFAIL",
    });
  });

  it("supports a separate Australian delivery address with the same form", async () => {
    render(<CheckoutView savedAddresses={[address]} />);
    await checkoutReady();
    fireEvent.click(screen.getByLabelText("Deliver to a different address"));
    const countries = screen.getAllByLabelText("Country");
    fireEvent.change(countries[1], { target: { value: "AU" } });
    expect(screen.getAllByLabelText("State / territory")).toHaveLength(1);
    expect(screen.getAllByLabelText("Full name")).toHaveLength(2);
  });

  it("shows clear recovery routes for an empty browser cart", () => {
    localStorage.clear();
    render(<CheckoutView />);
    expect(screen.getByRole("link", { name: "Browse Canvas" })).toHaveAttribute("href", "/canvas");
    expect(screen.getByRole("link", { name: "Browse Banners" })).toHaveAttribute("href", "/banners");
    expect(screen.getByRole("link", { name: "Design Gallery" })).toHaveAttribute("href", "/design-gallery");
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Your cart is empty" })).toBeInTheDocument();
  });

  it("preserves address fields after a Post quote fails and can retry", async () => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(postCart));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 2, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: { message: "Post unavailable" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 3, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shipping: { option: { method: "post", serviceCode: "post", serviceName: "Live Post", amountExGstCents: 2000, gstCents: 300, amountInclGstCents: 2300, currency: "NZD", provenance: "gosweetspot", isTest: false } } }) })
      .mockResolvedValueOnce(methodsResponse);
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);

    await checkoutReady();
    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    await screen.findByText("Post unavailable");
    expect(screen.getByLabelText("Street address")).toHaveValue("12 Queen Street");
    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    await screen.findByText(/Live carrier rate/);
  });

  it("restores partially entered checkout details after a refresh without trusting old totals", async () => {
    const firstRender = render(<CheckoutView savedAddresses={[address]} />);
    await checkoutReady();
    fireEvent.change(screen.getByLabelText("Street address"), { target: { value: "44 Refresh Road" } });
    fireEvent.change(screen.getByLabelText("Building / unit (optional)"), { target: { value: "Unit 3" } });
    await waitFor(() => expect(sessionStorage.getItem(checkoutDraftStorageKey)).toContain("44 Refresh Road"));
    firstRender.unmount();

    render(<CheckoutView savedAddresses={[address]} />);

    await checkoutReady();
    expect(screen.getByLabelText("Street address")).toHaveValue("44 Refresh Road");
    expect(screen.getByLabelText("Building / unit (optional)")).toHaveValue("Unit 3");
    expect(screen.queryByRole("heading", { name: "Delivery" })).not.toBeInTheDocument();
    expect(screen.getByText("Your checkout details were restored. Review delivery and totals again.")).toBeInTheDocument();
    expect(screen.getByText("Review delivery to see authoritative totals.")).toBeInTheDocument();
  });

  it("shows a useful retry message when the checkout network request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<CheckoutView savedAddresses={[address]} />);
    await checkoutReady();

    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));

    expect(await screen.findByText("We couldn’t review delivery right now. Check your connection and try again.")).toBeInTheDocument();
    expect(screen.queryByText("Failed to fetch")).not.toBeInTheDocument();
  });

  it("posts an exact separate Australian delivery address without saved IDs", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 2, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shipping: { option: { method: "pickup", serviceCode: "pickup", serviceName: "Pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, currency: "NZD", provenance: "internal", isTest: false } } }) })
      .mockResolvedValueOnce(methodsResponse);
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);
    await checkoutReady();
    fireEvent.click(screen.getByLabelText("Deliver to a different address"));
    fireEvent.change(screen.getAllByLabelText("Country")[1], { target: { value: "AU" } });
    fireEvent.change(screen.getAllByLabelText("Street address")[1], { target: { value: "25 George Street" } });
    fireEvent.change(screen.getAllByLabelText("Suburb")[1], { target: { value: "Sydney" } });
    fireEvent.change(screen.getByLabelText("State / territory"), { target: { value: "NSW" } });
    fireEvent.change(screen.getAllByLabelText("Postcode")[1], { target: { value: "2000" } });
    fireEvent.change(screen.getAllByLabelText("Phone")[1], { target: { value: "+61412345678" } });
    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    await screen.findByText(/No shipping charge/);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.useDifferentDeliveryAddress).toBe(true);
    expect(body.deliveryAddress).toEqual({ country: "AU", fullName: "Aroha Ngata", building: "", street: "25 George Street", suburb: "Sydney", region: "NSW", postcode: "2000", phone: "+61412345678", email: "aroha@example.test" });
    expect(JSON.stringify(body)).not.toContain("saved-1");
  });

  it("associates local address errors and focuses the first invalid field", async () => {
    render(<CheckoutView />);
    await checkoutReady();
    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    expect(await screen.findByText("Correct the highlighted address fields, then review again.")).toBeInTheDocument();
    expect(screen.getByText("Full name is required.")).toBeInTheDocument();
    expect(screen.getByText("Street address is required.")).toBeInTheDocument();
    expect(screen.getByText("Enter a 4-digit postcode.")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.queryByText(/Too small:|expected string|must match pattern/)).not.toBeInTheDocument();
    const firstInvalid = document.querySelector<HTMLElement>('[aria-invalid="true"]');
    expect(firstInvalid).toHaveAccessibleDescription();
    await waitFor(() => expect(document.activeElement).toBe(firstInvalid));
  });

  it("submits a review from the checkout form and locks request-changing controls while pending", async () => {
    let resolveSession!: (value: unknown) => void;
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveSession = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);

    await checkoutReady();
    fireEvent.submit(screen.getByRole("form", { name: "Checkout details" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("Saved billing address")).toBeDisabled();
    expect(screen.getByLabelText("Street address")).toBeDisabled();
    expect(screen.getByLabelText("Deliver to a different address")).toBeDisabled();
    expect(screen.queryByRole("radiogroup", { name: "Delivery" })).not.toBeInTheDocument();

    fireEvent.submit(screen.getByRole("form", { name: "Checkout details" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveSession({ ok: false, json: async () => ({ error: { message: "Stop" } }) });
    await screen.findByText("Stop");
  });

  it("keeps saved billing and delivery selections independent", async () => {
    const second = { ...address, id: "saved-2", fullName: "Mereana Rangi", street: "9 Lake Road", suburb: "Takapuna", postcode: "0622" };
    render(<CheckoutView savedAddresses={[address, second]} />);

    await checkoutReady();
    fireEvent.click(screen.getByLabelText("Deliver to a different address"));
    fireEvent.change(screen.getByLabelText("Saved billing address"), { target: { value: "saved-2" } });
    expect(screen.getAllByLabelText("Street address")[0]).toHaveValue("9 Lake Road");
    expect(screen.getAllByLabelText("Street address")[1]).toHaveValue("12 Queen Street");
    expect(screen.getByLabelText("Saved delivery address")).toHaveValue("saved-1");
  });

  it("invalidates reviewed checkout after a server CHECKOUT_CHANGED response", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 2, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shipping: { option: { method: "pickup", serviceCode: "pickup", serviceName: "Pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, currency: "NZD", provenance: "internal", isTest: false } } }) })
      .mockResolvedValueOnce(methodsResponse)
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: { code: "CHECKOUT_CHANGED", message: "Changed" } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);
    await checkoutReady();
    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    await screen.findByText(/No shipping charge/);
    fireEvent.click(screen.getByRole("button", { name: /Continue to/ }));

    expect(await screen.findByText("Checkout changed. Review delivery and totals again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue to/ })).toBeDisabled();
    expect(screen.getByText("Review delivery to see authoritative totals.")).toBeInTheDocument();
    expect(localStorage.getItem(CART_STORAGE_KEY)).not.toBeNull();
  });

  it("reuses one idempotency key after an unmount until an order succeeds", async () => {
    const failingFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 2, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shipping: { option: { method: "pickup", serviceCode: "pickup", serviceName: "Pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, currency: "NZD", provenance: "internal", isTest: false } } }) })
      .mockResolvedValueOnce(methodsResponse)
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: { message: "Try again" } }) });
    vi.stubGlobal("fetch", failingFetch);
    const firstRender = render(<CheckoutView savedAddresses={[address]} />);
    await checkoutReady();
    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    await screen.findByText(/No shipping charge/);
    fireEvent.click(screen.getByRole("button", { name: /Continue to/ }));
    await screen.findByText("Try again");
    const firstKey = JSON.parse(failingFetch.mock.calls[3][1].body).idempotencyKey;
    firstRender.unmount();

    const succeedingFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ order: { orderNumber: "RNR-2026-XYZ" } }) })
      .mockResolvedValueOnce(paymentResponse);
    vi.stubGlobal("fetch", succeedingFetch);
    render(<CheckoutView savedAddresses={[address]} />);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/RNR-2026-XYZ#payment"));
    expect(succeedingFetch).toHaveBeenCalledTimes(2);
    expect(succeedingFetch.mock.calls[0][0]).toBe("/api/checkout/order");
    expect(JSON.parse(succeedingFetch.mock.calls[0][1].body).idempotencyKey).toBe(firstKey);
  });

  it("persists the exact non-PII placing intent before sending an order request", async () => {
    let resolveOrder!: (value: unknown) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 2, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shipping: { option: { method: "pickup", serviceCode: "pickup", serviceName: "Pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, currency: "NZD", provenance: "internal", isTest: false } } }) })
      .mockResolvedValueOnce(methodsResponse)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOrder = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);
    await checkoutReady();
    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    await screen.findByText(/No shipping charge/);
    fireEvent.click(screen.getByRole("button", { name: /Continue to/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));

    const persisted = JSON.parse(sessionStorage.getItem(paymentIntentStorageKey)!);
    expect(persisted).toMatchObject({ schemaVersion: 1, phase: "placing_order", method: "card", checkoutVersion: 2, cartDigest: "a".repeat(64), shipping: { method: "pickup", serviceCode: "pickup" } });
    expect(JSON.stringify(persisted)).not.toMatch(/address|email|phone|street/i);
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({
      idempotencyKey: persisted.orderIdempotencyKey,
      checkoutVersion: persisted.checkoutVersion,
      cartDigest: persisted.cartDigest,
      shipping: persisted.shipping,
    });
    expect(JSON.parse(localStorage.getItem(pendingCheckoutStorageKey)!)).toEqual({
      schemaVersion: 1,
      intent: persisted,
      cart,
    });

    resolveOrder({ ok: false, status: 500, json: async () => ({ error: { code: "INTERNAL_ERROR", message: "Lost response" } }) });
    await screen.findByText("Lost response");
  });

  it("keeps the ordered cart snapshot when another tab changes the cart before the order response", async () => {
    let resolveOrder!: (value: unknown) => void;
    const changedCart = {
      ...cart,
      items: [{ ...cart.items[0], quantity: 2 }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 2, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shipping: { option: { method: "pickup", serviceCode: "pickup", serviceName: "Pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, currency: "NZD", provenance: "internal", isTest: false } } }) })
      .mockResolvedValueOnce(methodsResponse)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOrder = resolve; }))
      .mockResolvedValueOnce(paymentResponse);
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);
    await checkoutReady();
    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    await screen.findByRole("radiogroup", { name: "Payment method" });
    fireEvent.click(screen.getByRole("button", { name: /Continue to/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));

    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(changedCart));
    resolveOrder({ ok: true, json: async () => ({ order: { orderNumber: "RNR-2026-ORIGINAL-CART" } }) });

    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/RNR-2026-ORIGINAL-CART#payment"));
    const pending = JSON.parse(localStorage.getItem(pendingCheckoutStorageKey)!);
    expect(pending.intent).toMatchObject({
      phase: "starting_payment",
      orderNumber: "RNR-2026-ORIGINAL-CART",
    });
    expect(pending.cart).toEqual(cart);
    expect(localStorage.getItem(CART_STORAGE_KEY)).toBe(JSON.stringify(changedCart));
  });

  it("does not overwrite a changed cart when payment startup fails", async () => {
    const changedCart = {
      ...cart,
      items: [{ ...cart.items[0], quantity: 2 }],
    };
    let resolvePayment!: (value: unknown) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 2, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shipping: { option: { method: "pickup", serviceCode: "pickup", serviceName: "Pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, currency: "NZD", provenance: "internal", isTest: false } } }) })
      .mockResolvedValueOnce(methodsResponse)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ order: { orderNumber: "RNR-2026-PAYMENT-ERROR" } }) })
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePayment = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);
    await checkoutReady();
    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    await screen.findByRole("radiogroup", { name: "Payment method" });
    fireEvent.click(screen.getByRole("button", { name: /Continue to/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));

    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(changedCart));
    resolvePayment({
      ok: false,
      status: 503,
      json: async () => ({ error: { code: "PAYMENT_UNAVAILABLE", message: "Payment is temporarily unavailable" } }),
    });

    expect(await screen.findByText("Payment is temporarily unavailable")).toBeInTheDocument();
    expect(localStorage.getItem(CART_STORAGE_KEY)).toBe(JSON.stringify(changedCart));
  });

  it("never rebinds a recovering order to a cart changed in another tab", async () => {
    const intent = placementIntent("70000000-0000-4000-8000-000000000016");
    const changedCart = {
      ...cart,
      items: [{ ...cart.items[0], quantity: 2 }],
    };
    sessionStorage.setItem(paymentIntentStorageKey, JSON.stringify(intent));
    localStorage.setItem(pendingCheckoutStorageKey, JSON.stringify({ schemaVersion: 1, intent, cart }));
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(changedCart));
    let resolvePayment!: (value: unknown) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ order: { orderNumber: "RNR-2026-RECOVER-ORIGINAL" } }) })
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePayment = resolve; }));
    vi.stubGlobal("fetch", fetchMock);

    render(<CheckoutView savedAddresses={[address]} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(localStorage.getItem(pendingCheckoutStorageKey)!)).toMatchObject({
      intent: {
        phase: "starting_payment",
        orderNumber: "RNR-2026-RECOVER-ORIGINAL",
        orderIdempotencyKey: intent.orderIdempotencyKey,
      },
      cart,
    });

    resolvePayment({
      ok: true,
      json: async () => ({
        payment: { method: "card", status: "paid", isTest: true, canRetry: false },
        action: null,
      }),
    });

    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/RNR-2026-RECOVER-ORIGINAL#payment"));
    expect(localStorage.getItem(CART_STORAGE_KEY)).toBe(JSON.stringify(changedCart));
    expect(localStorage.getItem(pendingCheckoutStorageKey)).toBeNull();
  });

  it("recovers a pending placement before any new review and deduplicates a remount", async () => {
    const intent = placementIntent("70000000-0000-4000-8000-000000000002");
    sessionStorage.setItem(paymentIntentStorageKey, JSON.stringify(intent));
    let resolveRecovery!: (value: unknown) => void;
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRecovery = resolve; }))
      .mockResolvedValueOnce(paymentResponse);
    vi.stubGlobal("fetch", fetchMock);

    const first = render(<CheckoutView savedAddresses={[address]} />);
    expect(screen.getByRole("button", { name: "Checking order status…" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/checkout/order");
    expect(screen.getByLabelText("Street address")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Review delivery & totals" })).toBeDisabled();
    first.unmount();
    render(<CheckoutView savedAddresses={[address]} />);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveRecovery({ ok: true, json: async () => ({ order: { orderNumber: "RNR-2026-RECOVERED" } }) });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/RNR-2026-RECOVERED#payment"));
    expect(localStorage.getItem(CART_STORAGE_KEY)).toBe(JSON.stringify(cart));
    expect(JSON.parse(sessionStorage.getItem(paymentIntentStorageKey)!)).toMatchObject({
      phase: "starting_payment", orderNumber: "RNR-2026-RECOVERED",
    });
  });

  it("keeps a failed recovery intent locked for retry without creating a checkout session", async () => {
    const intent = placementIntent("70000000-0000-4000-8000-000000000003");
    sessionStorage.setItem(paymentIntentStorageKey, JSON.stringify(intent));
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: { code: "INTERNAL_ERROR", message: "Temporarily unavailable" } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);

    expect(await screen.findByText("Temporarily unavailable")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/checkout/order");
    expect(sessionStorage.getItem(paymentIntentStorageKey)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Review delivery & totals" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Retry order recovery" })).toBeEnabled();
  });

  it("invalidates a fatal recovery response and requires a fresh review", async () => {
    const intent = placementIntent("70000000-0000-4000-8000-000000000004");
    sessionStorage.setItem(paymentIntentStorageKey, JSON.stringify(intent));
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: { code: "CHECKOUT_CHANGED", message: "Changed" } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);

    expect(await screen.findByText("Checkout changed. Review delivery and totals again.")).toBeInTheDocument();
    expect(sessionStorage.getItem(paymentIntentStorageKey)).toBeNull();
    expect(screen.getByRole("button", { name: "Review delivery & totals" })).toBeEnabled();
  });

  it("discards an inaccessible payment recovery instead of sending the customer to a missing order page", async () => {
    const intent = placementIntent("70000000-0000-4000-8000-000000000011");
    sessionStorage.setItem(paymentIntentStorageKey, JSON.stringify(intent));
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ order: { orderNumber: "RNR-2026-STALE" } }) })
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ error: { code: "ORDER_NOT_FOUND", message: "Order is unavailable" } }) }));

    render(<CheckoutView savedAddresses={[address]} />);

    expect(await screen.findByText("Your previous payment session is no longer available. Your cart is ready to checkout.")).toBeInTheDocument();
    expect(sessionStorage.getItem(paymentIntentStorageKey)).toBeNull();
    expect(localStorage.getItem(CART_STORAGE_KEY)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Review delivery & totals" })).toBeEnabled();
    expect(push).not.toHaveBeenCalled();
  });

  it("keeps a newly added cart instead of resuming an older order payment", async () => {
    const intent = {
      ...placementIntent("70000000-0000-4000-8000-000000000012"),
      phase: "starting_payment" as const,
      orderNumber: "RNR-2026-OLDER-A4",
    };
    sessionStorage.setItem(paymentIntentStorageKey, JSON.stringify(intent));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<CheckoutView savedAddresses={[address]} />);

    await checkoutReady();
    expect(sessionStorage.getItem(paymentIntentStorageKey)).toBeNull();
    expect(localStorage.getItem(CART_STORAGE_KEY)).toBe(JSON.stringify(cart));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("unlocks checkout when a restored cart still has an older payment recovery", async () => {
    const intent = {
      ...placementIntent("70000000-0000-4000-8000-000000000013"),
      phase: "starting_payment" as const,
      orderNumber: "RNR-2026-RESTORED-CART",
    };
    sessionStorage.setItem(paymentIntentStorageKey, JSON.stringify(intent));
    sessionStorage.setItem("rnr:commerce:v1:guest:checkout:intent-cart-backup", JSON.stringify({
      schemaVersion: 1,
      intentKey: intent.orderIdempotencyKey,
      cart,
    }));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: { code: "INTERNAL_ERROR", message: "Temporarily unavailable" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CheckoutView savedAddresses={[address]} />);

    await waitFor(() => expect(screen.getByLabelText("Street address")).toBeEnabled());
    expect(sessionStorage.getItem(paymentIntentStorageKey)).toBeNull();
    expect(sessionStorage.getItem("rnr:commerce:v1:guest:checkout:intent-cart-backup")).toBeNull();
    expect(screen.getByRole("button", { name: "Review delivery & totals" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Retry payment recovery" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
    [409, "ORDER_CONFLICT"],
  ])("keeps a pending placement locked after a %s %s recovery response", async (status, code) => {
    const intent = placementIntent(`70000000-0000-4000-8000-00000000000${status === 401 ? 5 : status === 403 ? 6 : 7}`);
    sessionStorage.setItem(paymentIntentStorageKey, JSON.stringify(intent));
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({ error: { code, message: "Recovery requires attention" } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);

    expect(await screen.findByText("Recovery requires attention")).toBeInTheDocument();
    expect(sessionStorage.getItem(paymentIntentStorageKey)).toBe(JSON.stringify(intent));
    expect(screen.getByRole("button", { name: "Review delivery & totals" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Retry order recovery" })).toBeEnabled();
  });

  it("clears a malformed placement intent instead of sending it", async () => {
    sessionStorage.setItem(paymentIntentStorageKey, JSON.stringify({ schemaVersion: 1, orderIdempotencyKey: "bad", billingAddress: address }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);
    await checkoutReady();
    expect(sessionStorage.getItem(paymentIntentStorageKey)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Review delivery & totals" })).toBeEnabled();
  });

  it("loads authoritative payment methods after review and invalidates them when checkout changes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 2, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shipping: { option: { method: "pickup", serviceCode: "pickup", serviceName: "Pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, currency: "NZD", provenance: "internal", isTest: false } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ methods: [{ method: "afterpay", label: "Test Afterpay — no real payment", isTest: true }, { method: "card", label: "Test card — no real payment", isTest: true }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 3, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shipping: { option: { method: "pickup", serviceCode: "pickup", serviceName: "Pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, currency: "NZD", provenance: "internal", isTest: false } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ methods: [{ method: "card", label: "Test card — no real payment", isTest: true }] }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);
    await checkoutReady();
    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));

    expect(await screen.findByRole("radiogroup", { name: "Payment method" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Test card — no real payment" })).toBeChecked();
    expect(fetchMock.mock.calls[2][0]).toBe("/api/checkout/payment-methods");
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ checkoutVersion: 2, cartDigest: "a".repeat(64) });

    fireEvent.change(screen.getByLabelText("Street address"), { target: { value: "14 Queen Street" } });
    expect(screen.queryByRole("radiogroup", { name: "Payment method" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue to/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
    expect(screen.getByRole("radio", { name: "Test card — no real payment" })).toBeChecked();
  });

  it("keeps Place order disabled when the reviewed checkout has no configured methods", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 2, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shipping: { option: { method: "pickup", serviceCode: "pickup", serviceName: "Pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, currency: "NZD", provenance: "internal", isTest: false } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ methods: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);
    await checkoutReady();
    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    expect(await screen.findByText("Payment methods are not configured yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue to/ })).toBeDisabled();
  });

  it("persists non-sensitive placing and starting phases before each mutation", async () => {
    let resolveOrder!: (value: unknown) => void;
    let resolvePayment!: (value: unknown) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 2, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shipping: { option: { method: "pickup", serviceCode: "pickup", serviceName: "Pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, currency: "NZD", provenance: "internal", isTest: false } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ methods: [{ method: "card", label: "Test card — no real payment", isTest: true }] }) })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOrder = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePayment = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);
    await checkoutReady();
    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    await screen.findByRole("radiogroup", { name: "Payment method" });
    fireEvent.click(screen.getByRole("button", { name: /Continue to/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));

    const placing = JSON.parse(sessionStorage.getItem(paymentIntentStorageKey)!);
    expect(placing).toMatchObject({ schemaVersion: 1, phase: "placing_order", method: "card", checkoutVersion: 2, cartDigest: "a".repeat(64) });
    expect(placing.orderIdempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(placing.paymentIdempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(placing.paymentIdempotencyKey).not.toBe(placing.orderIdempotencyKey);
    expect(JSON.stringify(placing)).not.toMatch(/address|email|phone|street|internalId|secret|provider|state/i);

    resolveOrder({ ok: true, json: async () => ({ order: { orderNumber: "RNR-2026-PAY", paymentStatus: "awaiting_payment" } }) });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    const starting = JSON.parse(sessionStorage.getItem(paymentIntentStorageKey)!);
    expect(starting).toEqual({ ...placing, phase: "starting_payment", orderNumber: "RNR-2026-PAY" });
    expect(localStorage.getItem(CART_STORAGE_KEY)).toBe(JSON.stringify(cart));
    expect(screen.queryByRole("heading", { name: "Your cart is empty" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preparing payment…" })).toBeDisabled();
    expect(JSON.parse(fetchMock.mock.calls[4][1].body)).toEqual({ method: "card", idempotencyKey: placing.paymentIdempotencyKey });

    resolvePayment({ ok: true, json: async () => ({ payment: { method: "card", status: "processing", isTest: true, canRetry: false }, action: null }) });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/RNR-2026-PAY#payment"));
    expect(sessionStorage.getItem(paymentIntentStorageKey)).toBe(JSON.stringify(starting));
  });

  it("keeps the cart and a durable resume record while Stripe card details are unfinished", async () => {
    let scrollY = 900;
    let scrollBehaviorAtCall = "";
    vi.spyOn(window, "scrollY", "get").mockImplementation(() => scrollY);
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {
      scrollBehaviorAtCall = document.documentElement.style.scrollBehavior;
      scrollY = 0;
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 2, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shipping: { option: { method: "pickup", serviceCode: "pickup", serviceName: "Pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, currency: "NZD", provenance: "internal", isTest: false } } }) })
      .mockResolvedValueOnce(methodsResponse)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ order: { orderNumber: "RNR-2026-CARD-OPEN" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        payment: { method: "card", status: "processing", isTest: false, canRetry: false },
        action: { kind: "elements", method: "card", clientSecret: "pi_secret_open", returnUrl: "http://localhost:3000/api/payments/returns/stripe?state=safe" },
      }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);
    await checkoutReady();
    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    await screen.findByRole("radiogroup", { name: "Payment method" });

    fireEvent.click(screen.getByRole("button", { name: "Continue to secure card payment" }));

    const stripeForm = await screen.findByTestId("checkout-stripe-payment-form");
    expect(analytics.emitAnalyticsEvent.mock.calls
      .map(([event]) => (event as { event?: string }).event))
      .not.toContain("add_payment_info");
    fireEvent.click(screen.getByRole("button", { name: "Simulate Stripe submit" }));
    expect(analytics.emitAnalyticsEvent).toHaveBeenCalledWith({
      event: "add_payment_info",
      currency: "NZD",
      value: 65,
      payment_type: "card",
      items: [{
        item_id: "photo-print-canvas",
        item_name: "Photo Print Canvas",
        item_variant: "a4",
        price: 65,
        quantity: 1,
      }],
    });
    expect(stripeForm).toHaveAttribute("data-entry-scroll-y", "0");
    expect(scrollBehaviorAtCall).toBe("auto");
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "auto" }));
    expect(localStorage.getItem(CART_STORAGE_KEY)).toBe(JSON.stringify(cart));
    expect(JSON.parse(localStorage.getItem(pendingCheckoutStorageKey)!)).toMatchObject({
      schemaVersion: 1,
      intent: { phase: "starting_payment", orderNumber: "RNR-2026-CARD-OPEN" },
      cart,
    });
  });

  it.each(["afterpay", "zip"] as const)("tracks %s only after an accepted payment action", async (method) => {
    let resolvePayment!: (value: unknown) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 2, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shipping: { option: { method: "pickup", serviceCode: "pickup", serviceName: "Pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, currency: "NZD", provenance: "internal", isTest: false } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ methods: [{ method, label: method, isTest: false }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ order: { orderNumber: `RNR-2026-${method.toUpperCase()}` } }) })
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePayment = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);
    await checkoutReady();
    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    await screen.findByRole("radio", { name: method });

    fireEvent.click(screen.getByRole("button", { name: method === "afterpay" ? "Continue to Afterpay" : "Continue to Zip Pay" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(analytics.emitAnalyticsEvent.mock.calls
      .map(([event]) => (event as { event?: string }).event))
      .not.toContain("add_payment_info");

    resolvePayment({ ok: true, json: async () => ({
      payment: { method, status: "requires_action", isTest: false, canRetry: false },
      action: { kind: "redirect", method, redirectUrl: `https://pay.example.test/${method}` },
    }) });

    await waitFor(() => expect(analytics.emitAnalyticsEvent).toHaveBeenCalledWith({
      event: "add_payment_info",
      currency: "NZD",
      value: 65,
      payment_type: method,
      items: [{
        item_id: "photo-print-canvas",
        item_name: "Photo Print Canvas",
        item_variant: "a4",
        price: 65,
        quantity: 1,
      }],
    }));
  });

  it("opens the order page at the top after Stripe confirms payment", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 2, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shipping: { option: { method: "pickup", serviceCode: "pickup", serviceName: "Pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, currency: "NZD", provenance: "internal", isTest: false } } }) })
      .mockResolvedValueOnce(methodsResponse)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ order: { orderNumber: "RNR-2026-CARD-PAID" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        payment: { method: "card", status: "processing", isTest: false, canRetry: false },
        action: { kind: "elements", method: "card", clientSecret: "pi_secret_paid", returnUrl: "http://localhost:3000/api/payments/returns/stripe?state=safe" },
      }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);
    await checkoutReady();
    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    await screen.findByRole("radiogroup", { name: "Payment method" });
    fireEvent.click(screen.getByRole("button", { name: "Continue to secure card payment" }));

    fireEvent.click(await screen.findByRole("button", { name: "Simulate Stripe paid" }));

    expect(push).toHaveBeenCalledWith("/orders/RNR-2026-CARD-PAID", { scroll: true });
  });

  it("returns a reopened browser to the same unfinished order without creating another order", async () => {
    const intent = {
      ...placementIntent("70000000-0000-4000-8000-000000000014"),
      phase: "starting_payment" as const,
      orderNumber: "RNR-2026-REOPENED",
    };
    localStorage.setItem(pendingCheckoutStorageKey, JSON.stringify({ schemaVersion: 1, intent, cart }));
    sessionStorage.clear();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<CheckoutView savedAddresses={[address]} />);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/RNR-2026-REOPENED#payment"));
    expect(localStorage.getItem(CART_STORAGE_KEY)).toBe(JSON.stringify(cart));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("replays the same durable placing intent when the browser closes before the order response", async () => {
    const intent = placementIntent("70000000-0000-4000-8000-000000000015");
    localStorage.setItem(pendingCheckoutStorageKey, JSON.stringify({ schemaVersion: 1, intent, cart }));
    sessionStorage.clear();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ order: { orderNumber: "RNR-2026-REOPENED-PLACEMENT" } }) })
      .mockResolvedValueOnce(paymentResponse);
    vi.stubGlobal("fetch", fetchMock);

    render(<CheckoutView savedAddresses={[address]} />);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/RNR-2026-REOPENED-PLACEMENT#payment"));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/checkout/order");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).idempotencyKey).toBe(intent.orderIdempotencyKey);
    expect(JSON.parse(localStorage.getItem(pendingCheckoutStorageKey)!)).toMatchObject({
      intent: {
        phase: "starting_payment",
        orderNumber: "RNR-2026-REOPENED-PLACEMENT",
        orderIdempotencyKey: intent.orderIdempotencyKey,
      },
      cart,
    });
  });

  it("replays order-response and payment-response loss with the same distinct keys", async () => {
    const placing = {
      schemaVersion: 1, phase: "placing_order", orderIdempotencyKey: "70000000-0000-4000-8000-000000000008",
      paymentIdempotencyKey: "80000000-0000-4000-8000-000000000008", method: "card", checkoutVersion: 2,
      cartDigest: "a".repeat(64), shipping: { method: "pickup", serviceCode: "pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, isTest: false },
    };
    sessionStorage.setItem(paymentIntentStorageKey, JSON.stringify(placing));
    localStorage.setItem(pendingCheckoutStorageKey, JSON.stringify({
      schemaVersion: 1,
      intent: placing,
      cart,
    }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ order: { orderNumber: "RNR-2026-RECOVER-PAY", paymentStatus: "awaiting_payment" } }) })
      .mockRejectedValueOnce(new TypeError("Network response was lost after the request"));
    vi.stubGlobal("fetch", fetchMock);
    const first = render(<CheckoutView savedAddresses={[address]} />);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/RNR-2026-RECOVER-PAY#payment"));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).idempotencyKey).toBe(placing.orderIdempotencyKey);
    const starting = JSON.parse(sessionStorage.getItem(paymentIntentStorageKey)!);
    expect(starting).toMatchObject({ phase: "starting_payment", orderNumber: "RNR-2026-RECOVER-PAY", paymentIdempotencyKey: placing.paymentIdempotencyKey });
    expect(localStorage.getItem(CART_STORAGE_KEY)).toBe(JSON.stringify(cart));
    first.unmount();
    push.mockReset();

    const retryFetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ payment: { method: "card", status: "processing", isTest: false, canRetry: false }, action: { kind: "elements", method: "card", clientSecret: "safe-for-response-only", returnUrl: "http://localhost:3000/api/payments/returns/stripe?state=safe" } }) });
    vi.stubGlobal("fetch", retryFetch);
    render(<CheckoutView savedAddresses={[address]} />);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/RNR-2026-RECOVER-PAY#payment"));
    expect(retryFetch).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(paymentIntentStorageKey)).toBe(JSON.stringify(starting));
  });

  it("retains a starting intent when requires_action is returned without a safe action", async () => {
    const intent = { ...placementIntent("70000000-0000-4000-8000-000000000009"), phase: "starting_payment", orderNumber: "RNR-2026-NEEDS-ACTION" };
    sessionStorage.setItem(paymentIntentStorageKey, JSON.stringify(intent));
    localStorage.removeItem(CART_STORAGE_KEY);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ payment: { method: "card", status: "requires_action", isTest: true, canRetry: false }, action: null }) }));

    render(<CheckoutView savedAddresses={[address]} />);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/RNR-2026-NEEDS-ACTION#payment"));
    expect(sessionStorage.getItem(paymentIntentStorageKey)).toBe(JSON.stringify(intent));
    expect(localStorage.getItem(CART_STORAGE_KEY)).toBeNull();
  });

  it.each(["paid", "failed", "cancelled"] as const)("clears recovery only after authoritative %s status", async (status) => {
    const intent = { ...placementIntent("70000000-0000-4000-8000-000000000010"), phase: "starting_payment", orderNumber: "RNR-2026-TERMINAL" };
    sessionStorage.setItem(paymentIntentStorageKey, JSON.stringify(intent));
    localStorage.removeItem(CART_STORAGE_KEY);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      payment: { method: "card", status, isTest: true, canRetry: status !== "paid" }, action: null,
    }) }));

    render(<CheckoutView savedAddresses={[address]} />);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/RNR-2026-TERMINAL#payment"));
    expect(sessionStorage.getItem(paymentIntentStorageKey)).toBeNull();
  });
});
