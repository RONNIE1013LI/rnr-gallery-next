import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import styles from "@/components/storefront.module.css";
import { HttpError } from "@/server/auth/require-session";
import AccountPage from "./page";
import AccountLoading from "./loading";
import AddressesPage from "./addresses/page";

const { getOptionalSession, listByOwner, listPageByCustomer, redirect, requireSession } = vi.hoisted(() => ({
  getOptionalSession: vi.fn(),
  listByOwner: vi.fn(),
  listPageByCustomer: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }),
  requireSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect,
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("@/server/auth/require-session", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/auth/require-session")>();
  return { ...original, requireSession };
});
vi.mock("@/server/auth/get-optional-session", () => ({ getOptionalSession }));
vi.mock("@/server/db/client", () => ({ getDatabase: vi.fn(() => ({})) }));
vi.mock("@/server/addresses/drizzle-address-repository", () => ({
  createDrizzleAddressRepository: () => ({ listByOwner }),
}));
vi.mock("@/server/orders/drizzle-order-query-repository", () => ({
  createDrizzleOrderQueryRepository: () => ({ listPageByCustomer }),
}));

describe("protected account pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOptionalSession.mockResolvedValue({ user: { id: "user-1" } });
    requireSession.mockResolvedValue({ user: { id: "user-1" } });
    listByOwner.mockResolvedValue([]);
    listPageByCustomer.mockResolvedValue({
      items: [], total: 0, page: 1, pageSize: 1, pageCount: 0,
    });
  });

  it("renders account navigation after the optional session check identifies the customer", async () => {
    const { container } = render(await AccountPage());

    expect(getOptionalSession).toHaveBeenCalledOnce();
    expect(requireSession).not.toHaveBeenCalled();
    expect(container.querySelector("article")).toHaveClass(styles.accountOverview);
    const savedAddresses = screen.getByRole("link", { name: "Manage addresses" });
    expect(savedAddresses).toHaveAttribute("href", "/account/addresses");
    expect(screen.getByRole("link", { name: "View all orders" })).toHaveAttribute(
      "href",
      "/account/orders",
    );
    expect(screen.getByRole("button", { name: "Sign out" })).toHaveClass(
      styles.secondaryButton,
    );
    expect(screen.queryByText(/orders area is coming next/i)).not.toBeInTheDocument();
    expect(listPageByCustomer).toHaveBeenCalledWith("user-1", 1, 1);
    expect(listByOwner).toHaveBeenCalledWith("user-1");
  });

  it("renders the sign-in surface directly at /account for a guest", async () => {
    getOptionalSession.mockResolvedValue(null);
    requireSession.mockRejectedValue(new HttpError("Unauthorized", 401));

    render(await AccountPage());

    expect(screen.getByRole("heading", { name: "Welcome back." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Email" })).toBeEnabled();
    expect(redirect).not.toHaveBeenCalled();
    expect(listPageByCustomer).not.toHaveBeenCalled();
    expect(listByOwner).not.toHaveBeenCalled();
  });

  it("shows the usable sign-in surface while the account session is checked", () => {
    const { container } = render(<AccountLoading />);

    expect(container.querySelector("main")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("heading", { name: "Welcome back." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Email" })).toBeEnabled();
  });

  it("summarises the latest order and first saved address without extra queries", async () => {
    listPageByCustomer.mockResolvedValue({
      items: [{
        orderNumber: "RNR-2026-ABC",
        createdAt: "2026-08-05T00:00:00.000Z",
        paymentStatus: "paid",
        fulfilmentStatus: "designing",
        totals: { totalInclGstCents: 23000 },
      }],
      total: 1, page: 1, pageSize: 1, pageCount: 1,
    });
    listByOwner.mockResolvedValue([{
      fullName: "Aroha Ngata", building: "", street: "12 Queen Street",
      suburb: "Auckland Central", region: "Auckland", postcode: "1010",
    }]);

    render(await AccountPage());

    expect(screen.getByRole("link", { name: /RNR-2026-ABC/ })).toHaveAttribute(
      "href",
      "/account/orders/RNR-2026-ABC",
    );
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.getByText("Artwork in progress")).toBeInTheDocument();
    expect(screen.getByText("Aroha Ngata")).toBeInTheDocument();
    expect(screen.getByText(/12 Queen Street/)).toBeInTheDocument();
  });

  it("requires a session before reading the owner's addresses", async () => {
    render(await AddressesPage());

    expect(requireSession).toHaveBeenCalledOnce();
    expect(listByOwner).toHaveBeenCalledWith("user-1");
    expect(screen.getByRole("link", { name: "Back to account" })).toHaveClass(
      styles.accountBackLink,
    );
    expect(requireSession.mock.invocationCallOrder[0]).toBeLessThan(
      listByOwner.mock.invocationCallOrder[0],
    );
  });

  it("redirects unauthenticated visitors away from addresses", async () => {
    requireSession.mockRejectedValue(new HttpError("Unauthorized", 401));

    await expect(AddressesPage()).rejects.toThrow("REDIRECT:/account/sign-in");
    expect(redirect).toHaveBeenCalledWith("/account/sign-in?next=%2Faccount%2Faddresses");
    expect(listByOwner).not.toHaveBeenCalled();
  });
});
