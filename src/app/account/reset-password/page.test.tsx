import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ResetPasswordPage from "./page";

const { getPasswordResetTokenStatus } = vi.hoisted(() => ({
  getPasswordResetTokenStatus: vi.fn(),
}));

vi.mock("@/server/auth/password-reset-token", () => ({ getPasswordResetTokenStatus }));

describe("reset password page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the reset form only after a valid read-only token check", async () => {
    getPasswordResetTokenStatus.mockResolvedValue("valid");
    render(await ResetPasswordPage({ searchParams: Promise.resolve({ token: "valid-reset-token" }) }));

    expect(getPasswordResetTokenStatus).toHaveBeenCalledWith("valid-reset-token");
    expect(screen.getByLabelText("New password")).toBeInTheDocument();
  });

  it("offers recovery paths for an invalid, expired or used token", async () => {
    getPasswordResetTokenStatus.mockResolvedValue("invalid");
    render(await ResetPasswordPage({ searchParams: Promise.resolve({ token: "used-reset-token" }) }));

    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request a new reset link" })).toHaveAttribute("href", "/account/forgot-password");
    expect(screen.getByRole("link", { name: "Return to sign in" })).toHaveAttribute("href", "/account/sign-in");
  });

  it("shows a retry-safe state when token validation is unavailable", async () => {
    getPasswordResetTokenStatus.mockRejectedValue(new Error("database unavailable"));
    render(await ResetPasswordPage({ searchParams: Promise.resolve({ token: "valid-reset-token" }) }));

    expect(screen.getByText(/could not verify this reset link right now/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  it("does not query a token when the authentication callback reports an error", async () => {
    render(await ResetPasswordPage({ searchParams: Promise.resolve({ token: "secret-token", error: "INVALID_TOKEN" }) }));

    expect(getPasswordResetTokenStatus).not.toHaveBeenCalled();
    expect(screen.getByText(/invalid, expired or has already been used/i)).toBeInTheDocument();
  });
});
