import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AccountSignOut,
  type SignOutClient,
} from "./account-sign-out";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

function createClient(
  result: Awaited<ReturnType<SignOutClient["signOut"]>> = { error: null },
): SignOutClient {
  return { signOut: vi.fn().mockResolvedValue(result) };
}

describe("AccountSignOut", () => {
  beforeEach(() => replace.mockReset());

  it("signs out through Better Auth and replaces the sign-in route", async () => {
    const client = createClient();
    render(<AccountSignOut client={client} />);

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      expect(client.signOut).toHaveBeenCalledOnce();
      expect(replace).toHaveBeenCalledWith("/account/sign-in");
    });
  });

  it("disables the action while sign-out is pending", async () => {
    let resolveRequest:
      | ((response: { error: null }) => void)
      | undefined;
    const client: SignOutClient = {
      signOut: vi.fn(
        () =>
          new Promise<{ error: null }>((resolve) => {
            resolveRequest = resolve;
          }),
      ),
    };
    render(<AccountSignOut client={client} />);

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(screen.getByRole("button", { name: "Signing out…" })).toBeDisabled();
    await act(async () => resolveRequest?.({ error: null }));
  });

  it("announces a sign-out error and keeps the customer on the account page", async () => {
    const client = createClient({
      error: { message: "The session could not be ended." },
    });
    render(<AccountSignOut client={client} />);

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(
      await screen.findByText("The session could not be ended."),
    ).toHaveAttribute("aria-live", "polite");
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
  });
});
