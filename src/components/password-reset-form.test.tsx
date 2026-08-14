import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PasswordResetForm, type PasswordResetClient } from "./password-reset-form";

function client(overrides: Partial<PasswordResetClient> = {}): PasswordResetClient {
  return {
    requestPasswordReset: vi.fn().mockResolvedValue({ error: null }),
    resetPassword: vi.fn().mockResolvedValue({ error: null }),
    ...overrides,
  };
}

describe("PasswordResetForm", () => {
  it("requests a reset without revealing whether the email exists", async () => {
    const auth = client();
    render(<PasswordResetForm mode="request" client={auth} />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "customer@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    await waitFor(() => expect(auth.requestPasswordReset).toHaveBeenCalledWith({
      email: "customer@example.test",
      redirectTo: "/account/reset-password",
    }));
    expect(await screen.findByText(/If an account exists for that email/i)).toBeInTheDocument();
  });

  it("keeps request failures on the page", async () => {
    const auth = client({
      requestPasswordReset: vi.fn().mockResolvedValue({
        error: { message: "Password reset email is unavailable." },
      }),
    });
    render(<PasswordResetForm mode="request" client={auth} />);
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "customer@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByText("Password reset email is unavailable.")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("rejects mismatched passwords before consuming the token", async () => {
    const auth = client();
    render(<PasswordResetForm mode="reset" token="valid-token" client={auth} />);
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "new-password-123" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "different-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Passwords do not match.")).toBeInTheDocument();
    expect(auth.resetPassword).not.toHaveBeenCalled();
  });

  it("consumes a valid token once and directs the customer to sign in", async () => {
    const auth = client();
    render(<PasswordResetForm mode="reset" token="valid-token" client={auth} />);
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "new-password-123" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "new-password-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    await waitFor(() => expect(auth.resetPassword).toHaveBeenCalledWith({
      newPassword: "new-password-123",
      token: "valid-token",
    }));
    expect(await screen.findByText("Your password has been reset.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/account/sign-in",
    );
  });
});
