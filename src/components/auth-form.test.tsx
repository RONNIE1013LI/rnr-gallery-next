import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthForm, type AuthClient } from "./auth-form";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

function createClient(overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    signIn: { email: vi.fn().mockResolvedValue({ error: null }) },
    signUp: { email: vi.fn().mockResolvedValue({ error: null }) },
    ...overrides,
  };
}

describe("AuthForm", () => {
  beforeEach(() => replace.mockReset());

  it("associates sign-in labels with email and password inputs", () => {
    render(<AuthForm mode="sign-in" client={createClient()} />);

    expect(screen.getByLabelText("Email address")).toHaveAttribute("autocomplete", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
  });

  it("submits sign-in credentials and replaces the account route after success", async () => {
    const client = createClient();
    render(<AuthForm mode="sign-in" client={client} />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "alex@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(client.signIn.email).toHaveBeenCalledWith({
        email: "alex@example.com",
        password: "correct horse battery staple",
      });
      expect(replace).toHaveBeenCalledWith("/account");
    });
  });

  it("shows the full-name registration field and submits it with registration details", async () => {
    const client = createClient();
    render(<AuthForm mode="register" client={client} />);

    const fullName = screen.getByLabelText("Full name");
    expect(fullName).toHaveAttribute("autocomplete", "name");
    fireEvent.change(fullName, { target: { value: "Alex Morgan" } });
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "alex@example.com" },
    });
    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("autocomplete", "new-password");
    expect(password).toHaveAttribute("minlength", "8");
    fireEvent.change(password, { target: { value: "correct horse battery staple" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(client.signUp.email).toHaveBeenCalledWith({
        name: "Alex Morgan",
        email: "alex@example.com",
        password: "correct horse battery staple",
      });
      expect(replace).toHaveBeenCalledWith("/account");
    });
  });

  it("disables submit while an authentication request is pending", () => {
    let resolveRequest: ((response: { error: null }) => void) | undefined;
    const client = createClient({
      signIn: {
        email: vi.fn().mockImplementation(
          () => new Promise((resolve) => { resolveRequest = resolve; }),
        ),
      },
    });
    render(<AuthForm mode="sign-in" client={client} />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "alex@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
    resolveRequest?.({ error: null });
  });

  it("announces a provider error without navigating", async () => {
    const client = createClient({
      signIn: {
        email: vi.fn().mockResolvedValue({
          error: { message: "Incorrect email or password." },
        }),
      },
    });
    render(<AuthForm mode="sign-in" client={client} />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "alex@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText("Incorrect email or password."),
    ).toHaveAttribute("aria-live", "polite");
    expect(replace).not.toHaveBeenCalled();
  });

  it("links between sign-in and registration", () => {
    const { rerender } = render(<AuthForm mode="sign-in" client={createClient()} />);
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      "/account/register",
    );

    rerender(<AuthForm mode="register" client={createClient()} />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/account/sign-in",
    );
  });
});
