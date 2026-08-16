import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { hashCheckoutSessionToken } from "@/server/checkout/session-cookie";
import { createOrderEmailAccessToken } from "@/server/orders/order-email-access";
import type { PublicOrder } from "@/server/orders/order-query-service";
import { OrderSnapshotIntegrityError } from "@/server/orders/drizzle-order-query-repository";
import AccountOrderPage from "../account/orders/[orderNumber]/page";
import AccountOrdersPage from "../account/orders/page";
import OrderConfirmationPage from "./[orderNumber]/page";

const {
  cookies,
  findByCheckoutToken,
  findByCustomer,
  findByEmailAccess,
  getOptionalSession,
  getOptionalCustomerProofView,
  listPageByCustomer,
  listByCustomer,
  notFound,
  push,
  redirect,
  requireSession,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  findByCheckoutToken: vi.fn(),
  findByCustomer: vi.fn(),
  findByEmailAccess: vi.fn(),
  getOptionalSession: vi.fn(),
  getOptionalCustomerProofView: vi.fn(),
  listPageByCustomer: vi.fn(),
  listByCustomer: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
  push: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }),
  requireSession: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("next/navigation", () => ({ notFound, redirect, useRouter: () => ({ push }) }));
vi.mock("@/server/auth/get-optional-session", () => ({ getOptionalSession }));
vi.mock("@/server/production/optional-customer-proof", () => ({ getOptionalCustomerProofView }));
vi.mock("@/server/auth/require-session", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/auth/require-session")>();
  return { ...original, requireSession };
});
vi.mock("@/server/db/client", () => ({ getDatabase: vi.fn(() => ({})) }));
vi.mock("@/server/orders/drizzle-order-query-repository", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/orders/drizzle-order-query-repository")>(),
  createDrizzleOrderQueryRepository: () => ({
    findByCheckoutToken,
    findByCustomer,
    findByEmailAccess,
    listPageByCustomer,
    listByCustomer,
  }),
}));

const address = {
  country: "NZ",
  fullName: "Aroha Ngata",
  building: "",
  street: "12 Queen Street",
  suburb: "Auckland Central",
  region: "Auckland",
  postcode: "1010",
  phone: "+64211234567",
  email: "aroha@example.test",
} as const;
const order = Object.freeze({
  orderNumber: "RNR-2026-ABC",
  createdAt: "2026-08-02T12:30:00.000Z",
  paymentStatus: "awaiting_payment",
  fulfilmentStatus: "new",
  currency: "NZD",
  deliveryMethod: "pickup",
  shipping: Object.freeze({ provider: null, serviceName: "Pickup", isTest: false, amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0 }),
  totals: Object.freeze({ productSubtotalExGstCents: 15717, productGstCents: 2358, productTotalInclGstCents: 18075, totalExGstCents: 15717, totalGstCents: 2358, totalInclGstCents: 18075 }),
  items: Object.freeze([{ productTitle: "Photo Print Canvas", galleryDesign: Object.freeze({ id: "a".repeat(64), title: "Family at sunset", contentHash: "b".repeat(64), productSlug: "photo-print-canvas", imageUrl: `/gallery-images/${"a".repeat(64)}?v=${"b".repeat(64)}` }), sizeLabel: "A4", orientation: "landscape", peoplePets: 2, photoSubmissionMethod: "later", designText: "Family forever", notes: "Use the warm sunset reference", neededDate: "2026-08-10", urgentServiceConfirmed: true, urgentWorkingDays: 3, quantity: 1, priceLines: Object.freeze([{ key: "product-size", label: "Product / size price", amountExGstCents: 6500 }, { key: "people-pets", label: "People / pets fee", amountExGstCents: 4000 }, { key: "urgent-service", label: "Urgent service", amountExGstCents: 5217, amountInclGstCents: 6000 }, { key: "no-charge", label: "No charge", amountExGstCents: 0 }]), unitSubtotalExGstCents: 15717, unitGstCents: 2358, unitTotalInclGstCents: 18075, lineSubtotalExGstCents: 15717, lineGstCents: 2358, lineTotalInclGstCents: 18075 }]),
  addresses: Object.freeze({ billing: address, delivery: address }),
  payment: null,
}) as PublicOrder;

describe("owner-scoped order pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ENABLE_LOCAL_TEST_PAYMENTS", "true");
    vi.stubEnv("BETTER_AUTH_SECRET", "order-email-access-secret-with-sufficient-entropy-12345");
    cookies.mockResolvedValue({ get: () => ({ value: "a".repeat(43) }) });
    getOptionalSession.mockResolvedValue(null);
    getOptionalCustomerProofView.mockResolvedValue(null);
    requireSession.mockResolvedValue({ user: { id: "user-1" } });
    findByCheckoutToken.mockResolvedValue(order);
    findByCustomer.mockResolvedValue(order);
    findByEmailAccess.mockResolvedValue(order);
    listByCustomer.mockResolvedValue([order]);
    listPageByCustomer.mockResolvedValue({
      items: [order],
      total: 21,
      page: 2,
      pageSize: 20,
      pageCount: 2,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ methods: [
        { method: "card", label: "Test card — no real payment", isTest: true },
        { method: "afterpay", label: "Test Afterpay — no real payment", isTest: true },
      ] }),
    }));
  });

  it("authorizes guest confirmation with the checkout cookie and renders immutable totals", async () => {
    render(await OrderConfirmationPage({ params: Promise.resolve({ orderNumber: order.orderNumber }) }));

    expect(findByCheckoutToken).toHaveBeenCalledWith(
      order.orderNumber,
      hashCheckoutSessionToken("a".repeat(43)),
    );
    expect(screen.getByRole("heading", { level: 1, name: "Complete your payment." })).toBeInTheDocument();
    expect(screen.getByText("Payment required", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("Order received.")).not.toBeInTheDocument();
    expect(screen.getByText("3 August 2026", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Send Photos After Ordering")).toBeInTheDocument();
    expect(screen.getByText("Family forever")).toBeInTheDocument();
    expect(screen.getByText("Use the warm sunset reference")).toBeInTheDocument();
    expect(screen.getByText("Production completion date")).toBeInTheDocument();
    expect(screen.queryByText("Needed by")).not.toBeInTheDocument();
    expect(screen.getByText("Family at sunset")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Family at sunset" })).toHaveAttribute(
      "src",
      expect.stringContaining(`/gallery-images/${"a".repeat(64)}`),
    );
    expect(screen.getByText("Confirmed · 3 working days")).toBeInTheDocument();
    expect(screen.getByText("Product / size price")).toBeInTheDocument();
    expect(screen.getByText("People / pets fee")).toBeInTheDocument();
    expect(screen.getAllByText("Urgent service")).toHaveLength(2);
    expect(screen.getByText("NZ$74.75 incl GST")).toBeInTheDocument();
    expect(screen.getByText("NZ$46.00 incl GST")).toBeInTheDocument();
    expect(screen.getByText("NZ$60.00 incl GST")).toBeInTheDocument();
    expect(screen.queryByText(/ex GST/i)).not.toBeInTheDocument();
    expect(screen.queryByText("No charge")).not.toBeInTheDocument();
    expect(screen.getAllByText("NZ$180.75")).toHaveLength(3);
    expect(await screen.findByRole("radiogroup", { name: "Payment method" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Test card — no real payment" })).toBeChecked();
    expect(screen.getByText("No real payment will be taken.")).toBeInTheDocument();
  });

  it("places the order total alongside the first item card instead of the items heading", async () => {
    render(await OrderConfirmationPage({ params: Promise.resolve({ orderNumber: order.orderNumber }) }));

    const summary = screen.getByRole("heading", { level: 2, name: "Order summary" }).closest("aside");
    const items = screen.getByRole("heading", { level: 2, name: "Items" });
    const itemCard = screen.getByRole("heading", { level: 3, name: "Photo Print Canvas × 1" }).closest("article");

    expect(summary).not.toBeNull();
    expect(itemCard).not.toBeNull();
    expect(items.previousElementSibling).toBeNull();
    expect(items.nextElementSibling).toBe(itemCard?.parentElement);
    expect(summary?.previousElementSibling).toBe(itemCard?.parentElement);
  });

  it("returns not found when a guest cookie cannot access the guessed order", async () => {
    findByCheckoutToken.mockResolvedValue(null);
    await expect(OrderConfirmationPage({ params: Promise.resolve({ orderNumber: "RNR-2026-GUESSED" }) })).rejects.toThrow("NOT_FOUND");
    expect(findByCustomer).not.toHaveBeenCalled();
  });

  it("authorizes an emailed order link without relying on the original browser cookie", async () => {
    cookies.mockResolvedValue({ get: () => undefined });
    const access = createOrderEmailAccessToken(
      order.orderNumber,
      "order-email-access-secret-with-sufficient-entropy-12345",
    );

    render(await OrderConfirmationPage({
      params: Promise.resolve({ orderNumber: order.orderNumber }),
      searchParams: Promise.resolve({ access }),
    }));

    expect(findByCheckoutToken).not.toHaveBeenCalled();
    expect(findByCustomer).not.toHaveBeenCalled();
    expect(findByEmailAccess).toHaveBeenCalledWith(order.orderNumber);
    expect(screen.getByRole("heading", { level: 1, name: "Complete your payment." })).toBeInTheDocument();
  });

  it("falls back from a wrong checkout cookie only to the signed-in owner", async () => {
    findByCheckoutToken.mockResolvedValue(null);
    getOptionalSession.mockResolvedValue({ user: { id: "user-1" } });
    render(await OrderConfirmationPage({ params: Promise.resolve({ orderNumber: order.orderNumber }) }));
    expect(findByCustomer).toHaveBeenCalledWith(order.orderNumber, "user-1");
    expect(screen.getByRole("link", { name: "View account orders" })).toHaveAttribute("href", "/account/orders");

    findByCustomer.mockResolvedValue(null);
    await expect(OrderConfirmationPage({ params: Promise.resolve({ orderNumber: "RNR-2026-OTHER" }) })).rejects.toThrow("NOT_FOUND");
  });

  it("lists and reads only the authenticated customer's orders", async () => {
    render(await AccountOrdersPage({ searchParams: Promise.resolve({ page: "2" }) }));
    expect(listPageByCustomer).toHaveBeenCalledWith("user-1", 2);
    expect(screen.getByRole("link", { name: "Previous orders" })).toHaveAttribute("href", "/account/orders?page=1");
    expect(screen.getByRole("link", { name: /RNR-2026-ABC/ })).toHaveAttribute("href", "/account/orders/RNR-2026-ABC");
    expect(screen.getByText("Payment required")).toBeInTheDocument();
    expect(screen.getByText("3 August 2026")).toBeInTheDocument();

    render(await AccountOrderPage({ params: Promise.resolve({ orderNumber: order.orderNumber }) }));
    expect(findByCustomer).toHaveBeenCalledWith(order.orderNumber, "user-1");
    expect(screen.getAllByRole("heading", { level: 1, name: "Order details." })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /Continue to/ })).toHaveLength(1);
  });

  it("treats a malformed checkout cookie as absent before hashing or querying it", async () => {
    cookies.mockResolvedValue({ get: () => ({ value: "not-a-session-token" }) });
    getOptionalSession.mockResolvedValue({ user: { id: "user-1" } });

    render(await OrderConfirmationPage({ params: Promise.resolve({ orderNumber: order.orderNumber }) }));

    expect(findByCheckoutToken).not.toHaveBeenCalled();
    expect(findByCustomer).toHaveBeenCalledWith(order.orderNumber, "user-1");
  });

  it("hides non-applicable people, empty design fields and zero price lines", async () => {
    findByCheckoutToken.mockResolvedValue({
      ...order,
      items: [{
        ...order.items[0],
        peoplePets: 0,
        designText: "",
        notes: "  ",
        urgentServiceConfirmed: false,
        priceLines: [
          { key: "product-size", label: "Product / size price", amountExGstCents: 6500 },
          { key: "no-charge", label: "No charge", amountExGstCents: 0 },
        ],
      }],
    });

    render(await OrderConfirmationPage({ params: Promise.resolve({ orderNumber: order.orderNumber }) }));

    expect(screen.queryByText("People / pets", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("Design text")).not.toBeInTheDocument();
    expect(screen.queryByText("Design notes")).not.toBeInTheDocument();
    expect(screen.getByText("Not requested")).toBeInTheDocument();
    expect(screen.queryByText("No charge")).not.toBeInTheDocument();
  });

  it("does not show awaiting-payment guidance for a paid order", async () => {
    findByCheckoutToken.mockResolvedValue({
      ...order,
      paymentStatus: "paid",
      payment: { method: "card", status: "paid", canRetry: false, isTest: false },
    });

    render(await OrderConfirmationPage({ params: Promise.resolve({ orderNumber: order.orderNumber }) }));

    expect(screen.getByRole("heading", { level: 1, name: "Order confirmed." })).toBeInTheDocument();
    expect(screen.getAllByText("Paid", { exact: false }).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("button", { name: /Continue to/ })).not.toBeInTheDocument();
    expect(screen.getByText("Payment confirmed.")).toBeInTheDocument();
  });

  it("shows one clear test-rate disclosure instead of repeating the carrier warning", async () => {
    findByCheckoutToken.mockResolvedValue({
      ...order,
      deliveryMethod: "post",
      shipping: {
        provider: "test",
        serviceName: "Test Post — not a live carrier rate",
        isTest: true,
        amountExGstCents: 2000,
        gstCents: 300,
        amountInclGstCents: 2300,
      },
    });

    render(await OrderConfirmationPage({ params: Promise.resolve({ orderNumber: order.orderNumber }) }));

    expect(screen.getByText("Test Post · Test rate — not a live carrier rate")).toBeInTheDocument();
    expect(screen.queryByText("Test Post — not a live carrier rate · Test rate — not a live carrier rate")).not.toBeInTheDocument();
  });

  it("passes the authorized current attempt to the payment recovery panel", async () => {
    findByCheckoutToken.mockResolvedValue({
      ...order,
      paymentStatus: "failed",
      payment: { method: "afterpay", status: "failed", canRetry: true, isTest: true },
    });

    render(await OrderConfirmationPage({ params: Promise.resolve({ orderNumber: order.orderNumber }) }));

    expect(screen.getByText("Payment method")).toBeInTheDocument();
    expect(screen.getByText("Afterpay (test)")).toBeInTheDocument();
    expect(screen.getByText("Payment attempt")).toBeInTheDocument();
    expect(screen.getByText("Failed", { exact: true })).toBeInTheDocument();
    const summary = screen.getByRole("heading", { name: "Order summary" }).closest("aside");
    expect(summary).not.toBeNull();
    expect(within(summary!).getAllByRole("term").map(({ textContent }) => textContent)).toEqual([
      "Products incl GST",
      "Shipping incl GST",
      "Includes GST",
      "Payment method",
      "Payment attempt",
      "Total incl GST",
    ]);
    expect(await screen.findByRole("radio", { name: "Test Afterpay — no real payment" })).toBeChecked();
  });

  it("passes the authenticated customer's current attempt to the payment recovery panel", async () => {
    findByCustomer.mockResolvedValue({
      ...order,
      paymentStatus: "cancelled",
      payment: { method: "afterpay", status: "cancelled", canRetry: true, isTest: true },
    });

    render(await AccountOrderPage({ params: Promise.resolve({ orderNumber: order.orderNumber }) }));

    expect(await screen.findByRole("radio", { name: "Test Afterpay — no real payment" })).toBeChecked();
  });

  it("fails closed when an immutable order snapshot cannot be validated", async () => {
    findByCheckoutToken.mockRejectedValue(new OrderSnapshotIntegrityError());

    await expect(OrderConfirmationPage({ params: Promise.resolve({ orderNumber: order.orderNumber }) }))
      .rejects.toThrow("NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("fails closed on corrupt account history or owner detail snapshots", async () => {
    listPageByCustomer.mockRejectedValueOnce(new OrderSnapshotIntegrityError());
    await expect(AccountOrdersPage({})).rejects.toThrow("NOT_FOUND");

    findByCustomer.mockRejectedValueOnce(new OrderSnapshotIntegrityError());
    await expect(AccountOrderPage({ params: Promise.resolve({ orderNumber: order.orderNumber }) }))
      .rejects.toThrow("NOT_FOUND");
  });

  it("does not reveal another customer's order", async () => {
    findByCustomer.mockResolvedValue(null);
    await expect(AccountOrderPage({ params: Promise.resolve({ orderNumber: "RNR-2026-OTHER" }) })).rejects.toThrow("NOT_FOUND");
    expect(findByCustomer).toHaveBeenCalledWith("RNR-2026-OTHER", "user-1");
  });

  it("renders a semantic empty account history without querying another owner", async () => {
    listPageByCustomer.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, pageCount: 0 });
    const { container } = render(await AccountOrdersPage({}));
    expect(container.querySelector("main#main-content")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Your orders." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "No orders yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Explore products" })).toHaveAttribute("href", "/shop");
    expect(findByCustomer).not.toHaveBeenCalled();
  });

  it.each([
    ["history", () => AccountOrdersPage({})],
    ["detail", () => AccountOrderPage({ params: Promise.resolve({ orderNumber: order.orderNumber }) })],
  ])("redirects an unauthenticated account order %s request before querying", async (_name, page) => {
    requireSession.mockRejectedValue(new HttpError("Unauthorized", 401));
    await expect(page()).rejects.toThrow("REDIRECT:/account/sign-in");
    expect(listPageByCustomer).not.toHaveBeenCalled();
    expect(findByCustomer).not.toHaveBeenCalled();
  });
});
