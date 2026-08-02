import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import styles from "@/components/storefront.module.css";
import { HttpError } from "@/server/auth/require-session";
import AccountPage from "./page";
import AddressesPage from "./addresses/page";

const { listByOwner, redirect, requireSession } = vi.hoisted(() => ({
  listByOwner: vi.fn(),
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
vi.mock("@/server/db/client", () => ({ getDatabase: vi.fn(() => ({})) }));
vi.mock("@/server/addresses/drizzle-address-repository", () => ({
  createDrizzleAddressRepository: () => ({ listByOwner }),
}));

describe("protected account pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSession.mockResolvedValue({ user: { id: "user-1" } });
    listByOwner.mockResolvedValue([]);
  });

  it("renders account navigation only after requiring a session", async () => {
    render(await AccountPage());

    expect(requireSession).toHaveBeenCalledOnce();
    const savedAddresses = screen.getByRole("link", { name: "Saved addresses" });
    expect(savedAddresses).toHaveAttribute("href", "/account/addresses");
    expect(savedAddresses).toHaveClass(styles.secondaryButton);
    expect(screen.getByRole("link", { name: "Orders" })).toHaveClass(
      styles.secondaryButton,
    );
    expect(screen.getByRole("button", { name: "Sign out" })).toHaveClass(
      styles.secondaryButton,
    );
    expect(screen.getByText(/orders area is coming next/i)).toBeInTheDocument();
    expect(screen.queryByText(/order tracking.*works/i)).not.toBeInTheDocument();
  });

  it("requires a session before reading the owner's addresses", async () => {
    render(await AddressesPage());

    expect(requireSession).toHaveBeenCalledOnce();
    expect(listByOwner).toHaveBeenCalledWith("user-1");
    expect(requireSession.mock.invocationCallOrder[0]).toBeLessThan(
      listByOwner.mock.invocationCallOrder[0],
    );
  });

  it.each([
    ["account", AccountPage],
    ["addresses", AddressesPage],
  ])("redirects unauthenticated visitors away from %s", async (_name, page) => {
    requireSession.mockRejectedValue(new HttpError("Unauthorized", 401));

    await expect(page()).rejects.toThrow("REDIRECT:/account/sign-in");
    expect(redirect).toHaveBeenCalledWith("/account/sign-in");
    expect(listByOwner).not.toHaveBeenCalled();
  });
});
