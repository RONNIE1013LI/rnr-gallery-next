import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CART_STORAGE_KEY, type Cart } from "@/domain/cart/types";
import { canonicalCheckoutCart, CheckoutView } from "./checkout-view";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const cart: Cart = { version: 1, items: [{
  id: "30000000-0000-4000-8000-000000000001", productKey: "photo-print-canvas",
  productSlug: "photo-print-canvas", productTitle: "Browser title", imageSrc: "/test.jpg",
  sizeKey: "a4", sizeLabel: "Browser size", orientation: "landscape", peoplePets: 0,
  photoSubmissionMethod: "later", designText: "Family", notes: "", neededDate: "2026-08-10",
  urgentServiceConfirmed: false, deliveryPreference: "pickup", quantity: 1,
  price: { lines: [], subtotalExGstCents: 1, gstCents: 1, totalInclGstCents: 2 }, uploadReferences: [],
}] };
const address = { id: "saved-1", country: "NZ" as const, fullName: "Aroha Ngata", building: "", street: "12 Queen Street", suburb: "Auckland Central", region: "Auckland", postcode: "1010", phone: "+64211234567", email: "aroha@example.test" };
const repriced = { version: 1, orderDate: "2026-08-03", items: [{ clientItemId: cart.items[0].id, productKey: "photo-print-canvas", productSlug: "photo-print-canvas", productTitle: "Photo Print Canvas", sizeKey: "a4", sizeLabel: "A4", orientation: "landscape", peoplePets: 0, photoSubmissionMethod: "later", designText: "Family", notes: "", neededDate: "2026-08-10", urgentServiceConfirmed: false, urgentService: { workingDays: 5, feeInclGstCents: 0 }, quantity: 1, uploadReferences: [], unitPrice: { lines: [], subtotalExGstCents: 6500, gstCents: 975, totalInclGstCents: 7475 }, lineSubtotalExGstCents: 6500, lineGstCents: 975, lineTotalInclGstCents: 7475 }], subtotalExGstCents: 6500, gstCents: 975, totalInclGstCents: 7475, itemCount: 1, cartDigest: "a".repeat(64) };
const placementStorageKey = "rnr-checkout-pending-placement-v1";
function placementIntent(idempotencyKey = "70000000-0000-4000-8000-000000000001") { return { schemaVersion: 1, idempotencyKey, checkoutVersion: 2, cartDigest: "a".repeat(64), shipping: { method: "pickup", serviceCode: "pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, isTest: false } }; }
async function checkoutReady() { return screen.findByRole("button", { name: "Review delivery & totals" }); }

describe("CheckoutView", () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart)); push.mockReset(); vi.restoreAllMocks(); });

  it("builds a canonical request without browser pricing or labels", () => {
    const input = canonicalCheckoutCart(cart);
    expect(input.items[0]).toMatchObject({ clientItemId: cart.items[0].id, productKey: "photo-print-canvas", sizeKey: "a4", quantity: 1 });
    expect(JSON.stringify(input)).not.toMatch(/Browser title|Browser size|subtotalExGstCents|totalInclGstCents|price/);
  });

  it("keeps checkout controls locked until the client recovery check finishes", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);

    expect(screen.getByRole("button", { name: "Checking order status…" })).toBeDisabled();
    expect(screen.getByLabelText("Street address")).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Review delivery & totals" })).toBeEnabled();
  });

  it("replaces a malformed stored idempotency key before a new order is placed", async () => {
    sessionStorage.setItem("rnr-checkout-order-idempotency-v1", "not-a-uuid");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 2, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shipping: { option: { method: "pickup", serviceCode: "pickup", serviceName: "Pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, currency: "NZD", provenance: "internal", isTest: false } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ order: { orderNumber: "RNR-2026-FRESH" } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);

    await checkoutReady();
    const freshKey = sessionStorage.getItem("rnr-checkout-order-idempotency-v1");
    expect(freshKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(freshKey).not.toBe("not-a-uuid");
    fireEvent.click(screen.getByLabelText("Pickup"));
    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    await screen.findByText(/No shipping charge/);
    fireEvent.click(screen.getByRole("button", { name: "Place order" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/RNR-2026-FRESH"));
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).idempotencyKey).toBe(freshKey);
    expect(sessionStorage.getItem(placementStorageKey)).toBeNull();
  });

  it("prefills a saved address, defaults to Post, reviews server totals and clears only after success", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 2, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shipping: { option: { method: "post", serviceCode: "post", serviceName: "Live Post", amountExGstCents: 2000, gstCents: 300, amountInclGstCents: 2300, currency: "NZD", provenance: "gosweetspot", isTest: false } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ order: { orderNumber: "RNR-2026-ABC", totalInclGstCents: 9775 } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);

    expect(screen.getByLabelText("Full name")).toHaveValue("Aroha Ngata");
    expect(screen.getByLabelText("Post")).toBeChecked();
    await checkoutReady();
    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    await screen.findByText("$97.75");
    expect(screen.getByText("$65.00")).toBeInTheDocument();
    expect(screen.getByText("Shipping ex GST")).toBeInTheDocument();
    expect(screen.getByText(/Live carrier rate/)).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/checkout/session");
    const sessionBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sessionBody.deliveryMethod).toBe("post");
    expect(JSON.stringify(sessionBody)).not.toContain("saved-1");

    fireEvent.change(screen.getByLabelText("Street address"), { target: { value: "14 Queen Street" } });
    expect(screen.getByText("Changes need review.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Place order" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Street address"), { target: { value: "12 Queen Street" } });

    const placeOrder = screen.getByRole("button", { name: "Place order" });
    fireEvent.click(placeOrder);
    fireEvent.click(placeOrder);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/RNR-2026-ABC"));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({
      checkoutVersion: 2,
      cartDigest: "a".repeat(64),
      shipping: { method: "post", serviceCode: "post", amountInclGstCents: 2300 },
    });
    expect(localStorage.getItem(CART_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem("rnr-checkout-order-idempotency-v1")).toBeNull();
  });

  it("keeps the cart and idempotency key when order creation fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 2, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shipping: { option: { method: "pickup", serviceCode: "pickup", serviceName: "Pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, currency: "NZD", provenance: "internal", isTest: false } } }) })
      .mockResolvedValue({ ok: false, json: async () => ({ error: { message: "Try again" } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);
    await checkoutReady();
    fireEvent.click(screen.getByLabelText("Pickup"));
    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    await screen.findByText("$74.75");
    fireEvent.click(screen.getByRole("button", { name: "Place order" }));
    await screen.findByText("Try again");
    fireEvent.click(screen.getByRole("button", { name: "Retry order recovery" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const firstKey = JSON.parse(fetchMock.mock.calls[2][1].body).idempotencyKey;
    const secondKey = JSON.parse(fetchMock.mock.calls[3][1].body).idempotencyKey;
    expect(secondKey).toBe(firstKey);
    expect(sessionStorage.getItem("rnr-checkout-order-idempotency-v1")).toBe(firstKey);
    expect(localStorage.getItem(CART_STORAGE_KEY)).not.toBeNull();
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

  it("shows a shop action for an empty browser cart", () => {
    localStorage.clear();
    render(<CheckoutView />);
    expect(screen.getByRole("link", { name: "Explore products" })).toHaveAttribute("href", "/shop");
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Your cart is empty" })).toBeInTheDocument();
  });

  it("preserves address fields after Post fails and can immediately review Pickup", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 2, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: { message: "Post unavailable" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 3, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shipping: { option: { method: "pickup", serviceCode: "pickup", serviceName: "Pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, currency: "NZD", provenance: "internal", isTest: false } } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);

    await checkoutReady();
    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    await screen.findByText("Post unavailable");
    expect(screen.getByLabelText("Street address")).toHaveValue("12 Queen Street");
    fireEvent.click(screen.getByLabelText("Pickup"));
    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    await screen.findByText(/No shipping charge/);
  });

  it("posts an exact separate Australian delivery address without saved IDs", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 2, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shipping: { option: { method: "pickup", serviceCode: "pickup", serviceName: "Pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, currency: "NZD", provenance: "internal", isTest: false } } }) });
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
    fireEvent.click(screen.getByLabelText("Pickup"));
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
    expect(screen.getByLabelText("Post")).toBeDisabled();
    expect(screen.getByLabelText("Pickup")).toBeDisabled();

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
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: { code: "CHECKOUT_CHANGED", message: "Changed" } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);
    await checkoutReady();
    fireEvent.click(screen.getByLabelText("Pickup"));
    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    await screen.findByText(/No shipping charge/);
    fireEvent.click(screen.getByRole("button", { name: "Place order" }));

    expect(await screen.findByText("Checkout changed. Review delivery and totals again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Place order" })).toBeDisabled();
    expect(screen.getByText("Review delivery to see authoritative totals.")).toBeInTheDocument();
    expect(localStorage.getItem(CART_STORAGE_KEY)).not.toBeNull();
  });

  it("reuses one idempotency key after an unmount until an order succeeds", async () => {
    const failingFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 2, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shipping: { option: { method: "pickup", serviceCode: "pickup", serviceName: "Pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, currency: "NZD", provenance: "internal", isTest: false } } }) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: { message: "Try again" } }) });
    vi.stubGlobal("fetch", failingFetch);
    const firstRender = render(<CheckoutView savedAddresses={[address]} />);
    await checkoutReady();
    fireEvent.click(screen.getByLabelText("Pickup"));
    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    await screen.findByText(/No shipping charge/);
    fireEvent.click(screen.getByRole("button", { name: "Place order" }));
    await screen.findByText("Try again");
    const firstKey = JSON.parse(failingFetch.mock.calls[2][1].body).idempotencyKey;
    firstRender.unmount();

    const succeedingFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ order: { orderNumber: "RNR-2026-XYZ" } }) });
    vi.stubGlobal("fetch", succeedingFetch);
    render(<CheckoutView savedAddresses={[address]} />);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/RNR-2026-XYZ"));
    expect(succeedingFetch).toHaveBeenCalledTimes(1);
    expect(succeedingFetch.mock.calls[0][0]).toBe("/api/checkout/order");
    expect(JSON.parse(succeedingFetch.mock.calls[0][1].body).idempotencyKey).toBe(firstKey);
  });

  it("persists the exact non-PII placement intent before sending an order request", async () => {
    let resolveOrder!: (value: unknown) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkout: { version: 2, cart: repriced } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shipping: { option: { method: "pickup", serviceCode: "pickup", serviceName: "Pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, currency: "NZD", provenance: "internal", isTest: false } } }) })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOrder = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);
    await checkoutReady();
    fireEvent.click(screen.getByLabelText("Pickup"));
    fireEvent.click(screen.getByRole("button", { name: "Review delivery & totals" }));
    await screen.findByText(/No shipping charge/);
    fireEvent.click(screen.getByRole("button", { name: "Place order" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const persisted = JSON.parse(sessionStorage.getItem(placementStorageKey)!);
    expect(persisted).toMatchObject({ schemaVersion: 1, checkoutVersion: 2, cartDigest: "a".repeat(64), shipping: { method: "pickup", serviceCode: "pickup" } });
    expect(JSON.stringify(persisted)).not.toMatch(/address|email|phone|street/i);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      idempotencyKey: persisted.idempotencyKey,
      checkoutVersion: persisted.checkoutVersion,
      cartDigest: persisted.cartDigest,
      shipping: persisted.shipping,
    });

    resolveOrder({ ok: false, status: 500, json: async () => ({ error: { code: "INTERNAL_ERROR", message: "Lost response" } }) });
    await screen.findByText("Lost response");
  });

  it("recovers a pending placement before any new review and deduplicates a remount", async () => {
    const intent = placementIntent("70000000-0000-4000-8000-000000000002");
    sessionStorage.setItem(placementStorageKey, JSON.stringify(intent));
    sessionStorage.setItem("rnr-checkout-order-idempotency-v1", intent.idempotencyKey);
    let resolveRecovery!: (value: unknown) => void;
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>()
      .mockImplementation(() => new Promise((resolve) => { resolveRecovery = resolve; }));
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
    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/RNR-2026-RECOVERED"));
    expect(localStorage.getItem(CART_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(placementStorageKey)).toBeNull();
  });

  it("keeps a failed recovery intent locked for retry without creating a checkout session", async () => {
    const intent = placementIntent("70000000-0000-4000-8000-000000000003");
    sessionStorage.setItem(placementStorageKey, JSON.stringify(intent));
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: { code: "INTERNAL_ERROR", message: "Temporarily unavailable" } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);

    expect(await screen.findByText("Temporarily unavailable")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/checkout/order");
    expect(sessionStorage.getItem(placementStorageKey)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Review delivery & totals" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Retry order recovery" })).toBeEnabled();
  });

  it("invalidates a fatal recovery response and requires a fresh review", async () => {
    const intent = placementIntent("70000000-0000-4000-8000-000000000004");
    sessionStorage.setItem(placementStorageKey, JSON.stringify(intent));
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: { code: "CHECKOUT_CHANGED", message: "Changed" } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);

    expect(await screen.findByText("Checkout changed. Review delivery and totals again.")).toBeInTheDocument();
    expect(sessionStorage.getItem(placementStorageKey)).toBeNull();
    expect(screen.getByRole("button", { name: "Review delivery & totals" })).toBeEnabled();
  });

  it.each([
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
    [409, "ORDER_CONFLICT"],
  ])("keeps a pending placement locked after a %s %s recovery response", async (status, code) => {
    const intent = placementIntent(`70000000-0000-4000-8000-00000000000${status === 401 ? 5 : status === 403 ? 6 : 7}`);
    sessionStorage.setItem(placementStorageKey, JSON.stringify(intent));
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({ error: { code, message: "Recovery requires attention" } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);

    expect(await screen.findByText("Recovery requires attention")).toBeInTheDocument();
    expect(sessionStorage.getItem(placementStorageKey)).toBe(JSON.stringify(intent));
    expect(screen.getByRole("button", { name: "Review delivery & totals" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Retry order recovery" })).toBeEnabled();
  });

  it("clears a malformed placement intent instead of sending it", async () => {
    sessionStorage.setItem(placementStorageKey, JSON.stringify({ schemaVersion: 1, idempotencyKey: "bad", billingAddress: address }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutView savedAddresses={[address]} />);
    await checkoutReady();
    expect(sessionStorage.getItem(placementStorageKey)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Review delivery & totals" })).toBeEnabled();
  });
});
