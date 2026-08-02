import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { hashCheckoutSessionToken } from "@/server/checkout/session-cookie";
import type { PublicOrder } from "@/server/orders/order-query-service";
import AccountOrderPage from "../account/orders/[orderNumber]/page";
import AccountOrdersPage from "../account/orders/page";
import OrderConfirmationPage from "./[orderNumber]/page";

const {
  cookies,
  findByCheckoutToken,
  findByCustomer,
  getOptionalSession,
  listByCustomer,
  notFound,
  redirect,
  requireSession,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  findByCheckoutToken: vi.fn(),
  findByCustomer: vi.fn(),
  getOptionalSession: vi.fn(),
  listByCustomer: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
  redirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }),
  requireSession: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("next/navigation", () => ({ notFound, redirect }));
vi.mock("@/server/auth/get-optional-session", () => ({ getOptionalSession }));
vi.mock("@/server/auth/require-session", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/auth/require-session")>();
  return { ...original, requireSession };
});
vi.mock("@/server/db/client", () => ({ getDatabase: vi.fn(() => ({})) }));
vi.mock("@/server/orders/drizzle-order-query-repository", () => ({
  createDrizzleOrderQueryRepository: () => ({
    findByCheckoutToken,
    findByCustomer,
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
  createdAt: "2026-08-02T00:00:00.000Z",
  paymentStatus: "awaiting_payment",
  fulfilmentStatus: "new",
  currency: "NZD",
  deliveryMethod: "pickup",
  shipping: Object.freeze({ provider: null, serviceName: "Pickup", isTest: false, amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0 }),
  totals: Object.freeze({ productSubtotalExGstCents: 6500, productGstCents: 975, productTotalInclGstCents: 7475, totalExGstCents: 6500, totalGstCents: 975, totalInclGstCents: 7475 }),
  items: Object.freeze([{ productTitle: "Photo Print Canvas", sizeLabel: "A4", orientation: "landscape", peoplePets: 0, photoSubmissionMethod: "later", designText: "Family", notes: "", neededDate: "2026-08-10", urgentServiceConfirmed: false, urgentWorkingDays: 5, quantity: 1, unitSubtotalExGstCents: 6500, unitGstCents: 975, unitTotalInclGstCents: 7475, lineSubtotalExGstCents: 6500, lineGstCents: 975, lineTotalInclGstCents: 7475 }]),
  addresses: Object.freeze({ billing: address, delivery: address }),
}) as PublicOrder;

describe("owner-scoped order pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookies.mockResolvedValue({ get: () => ({ value: "a".repeat(43) }) });
    getOptionalSession.mockResolvedValue(null);
    requireSession.mockResolvedValue({ user: { id: "user-1" } });
    findByCheckoutToken.mockResolvedValue(order);
    findByCustomer.mockResolvedValue(order);
    listByCustomer.mockResolvedValue([order]);
  });

  it("authorizes guest confirmation with the checkout cookie and renders immutable totals", async () => {
    render(await OrderConfirmationPage({ params: Promise.resolve({ orderNumber: order.orderNumber }) }));

    expect(findByCheckoutToken).toHaveBeenCalledWith(
      order.orderNumber,
      hashCheckoutSessionToken("a".repeat(43)),
    );
    expect(screen.getByRole("heading", { level: 1, name: "Order confirmed." })).toBeInTheDocument();
    expect(screen.getByText("Awaiting payment setup", { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText("$74.75")).toHaveLength(2);
    expect(screen.getByText("No payment has been requested on this test platform yet.")).toBeInTheDocument();
  });

  it("returns not found when a guest cookie cannot access the guessed order", async () => {
    findByCheckoutToken.mockResolvedValue(null);
    await expect(OrderConfirmationPage({ params: Promise.resolve({ orderNumber: "RNR-2026-GUESSED" }) })).rejects.toThrow("NOT_FOUND");
    expect(findByCustomer).not.toHaveBeenCalled();
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
    render(await AccountOrdersPage());
    expect(listByCustomer).toHaveBeenCalledWith("user-1");
    expect(screen.getByRole("link", { name: /RNR-2026-ABC/ })).toHaveAttribute("href", "/account/orders/RNR-2026-ABC");

    render(await AccountOrderPage({ params: Promise.resolve({ orderNumber: order.orderNumber }) }));
    expect(findByCustomer).toHaveBeenCalledWith(order.orderNumber, "user-1");
    expect(screen.getAllByRole("heading", { level: 1, name: "Order confirmed." })).toHaveLength(1);
  });

  it("does not reveal another customer's order", async () => {
    findByCustomer.mockResolvedValue(null);
    await expect(AccountOrderPage({ params: Promise.resolve({ orderNumber: "RNR-2026-OTHER" }) })).rejects.toThrow("NOT_FOUND");
    expect(findByCustomer).toHaveBeenCalledWith("RNR-2026-OTHER", "user-1");
  });

  it("renders a semantic empty account history without querying another owner", async () => {
    listByCustomer.mockResolvedValue([]);
    const { container } = render(await AccountOrdersPage());
    expect(container.querySelector("main#main-content")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Your orders." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "No orders yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Explore products" })).toHaveAttribute("href", "/shop");
    expect(findByCustomer).not.toHaveBeenCalled();
  });

  it.each([
    ["history", () => AccountOrdersPage()],
    ["detail", () => AccountOrderPage({ params: Promise.resolve({ orderNumber: order.orderNumber }) })],
  ])("redirects an unauthenticated account order %s request before querying", async (_name, page) => {
    requireSession.mockRejectedValue(new HttpError("Unauthorized", 401));
    await expect(page()).rejects.toThrow("REDIRECT:/account/sign-in");
    expect(listByCustomer).not.toHaveBeenCalled();
    expect(findByCustomer).not.toHaveBeenCalled();
  });
});
