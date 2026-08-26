import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { requireAdminPage, adminById } = vi.hoisted(() => ({
  requireAdminPage: vi.fn(), adminById: vi.fn(),
}));
vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/server/payment-requests/payment-request-runtime", () => ({
  getPaymentRequestRuntime: () => ({ adminById }),
}));
import AdminPaymentRequestPage from "./page";

describe("Admin Payment Request detail", () => {
  it("shows Admin-only detail and mutation controls", async () => {
    adminById.mockResolvedValue({
      id: "request-1", requestNumber: "PAY-2026-ABC", kind: "standalone",
      description: "Custom balance", amountCents: 20_000, currency: "NZD",
      status: "pending", methods: ["card"], internalNote: "Call before sending",
      createdByName: "Ronnie Lee",
      createdAt: "2026-08-18T00:00:00.000Z", updatedAt: "2026-08-18T00:00:00.000Z",
    });
    render(await AdminPaymentRequestPage({ params: Promise.resolve({ requestId: "request-1" }) }));
    expect(requireAdminPage).toHaveBeenCalledWith(
      "/admin/payment-requests/request-1", "manage_payment",
    );
    expect(screen.getByText("Call before sending")).toBeInTheDocument();
    expect(screen.getByText("Created by")).toBeInTheDocument();
    expect(screen.getByText("Ronnie Lee")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rotate payment link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel payment request" })).toBeInTheDocument();
  });
});
