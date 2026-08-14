import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import FormsSignInPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

describe("forms sign-in page", () => {
  it("presents staff-only access without customer self-registration", async () => {
    render(await FormsSignInPage({
      searchParams: Promise.resolve({ next: "/order-system?urgent=yes" }),
    }));

    expect(screen.getByText("Forms operator access")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Studio workbench." })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue with Email" }));
    expect(screen.getByLabelText("Email address")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create an account" })).not.toBeInTheDocument();
  });
});
