import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthForm, type AuthClient } from "./auth-form";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

function createClient(overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    signIn: { email: vi.fn().mockResolvedValue({ error: null, data: { user: { id: "customer-a" } } }) },
    signUp: { email: vi.fn().mockResolvedValue({ error: null, data: { user: { id: "customer-a" } } }) },
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

  it("returns staff email sign-in to a validated forms destination", async () => {
    const client = createClient();
    render(<AuthForm mode="sign-in" client={client} returnTo="/forms?urgent=yes" />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "operator@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/forms?urgent=yes"));
  });

  it("returns email sign-in to checkout", async () => {
    const client = createClient();
    render(<AuthForm mode="sign-in" client={client} returnTo="/checkout" />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "alex@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/checkout"));
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

  it("announces a safe sign-in error without exposing provider details", async () => {
    const client = createClient({
      signIn: {
        email: vi.fn().mockResolvedValue({
          error: { message: "User not found" },
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

    const error = await screen.findByText("Incorrect email or password.");
    expect(screen.queryByText("User not found")).not.toBeInTheDocument();
    expect(error).toHaveAttribute("aria-live", "polite");
    const email = screen.getByLabelText("Email address");
    const password = screen.getByLabelText("Password");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAttribute("aria-describedby", error.id);
    expect(password).toHaveAttribute("aria-describedby", error.id);

    fireEvent.change(email, { target: { value: "corrected@example.com" } });
    expect(email).not.toHaveAttribute("aria-invalid");
    expect(password).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Incorrect email or password.")).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("announces a safe registration error without exposing provider details", async () => {
    const client = createClient({
      signUp: {
        email: vi.fn().mockResolvedValue({
          error: { message: "User already exists" },
        }),
      },
    });
    render(<AuthForm mode="register" client={client} />);

    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Alex Morgan" } });
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "alex@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText(
      "We could not create this account. Try signing in or use a different email.",
    )).toBeInTheDocument();
    expect(screen.queryByText("User already exists")).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("associates native format errors with the affected field", () => {
    render(<AuthForm mode="sign-in" client={createClient()} />);
    const email = screen.getByLabelText("Email address");

    fireEvent.invalid(email);

    const error = screen.getByText("Enter your email address.");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAttribute("aria-describedby", error.id);
    fireEvent.change(email, { target: { value: "alex@example.com" } });
    expect(email).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Enter your email address.")).not.toBeInTheDocument();
  });

  it("links between sign-in and registration", () => {
    const { rerender } = render(<AuthForm mode="sign-in" client={createClient()} />);
    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute(
      "href",
      "/account/forgot-password",
    );
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      "/account/register",
    );

    rerender(<AuthForm mode="register" client={createClient()} />);
    expect(screen.queryByRole("link", { name: "Forgot password?" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/account/sign-in",
    );
  });

  it("preserves a validated return path when switching account modes", () => {
    const { rerender } = render(
      <AuthForm mode="sign-in" client={createClient()} returnTo="/account/orders?page=2" />,
    );
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      "/account/register?next=%2Faccount%2Forders%3Fpage%3D2",
    );

    rerender(<AuthForm mode="register" client={createClient()} returnTo="https://evil.example" />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/account/sign-in",
    );
  });
});
