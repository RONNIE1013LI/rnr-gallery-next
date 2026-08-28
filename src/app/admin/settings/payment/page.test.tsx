import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminPaymentStatus: vi.fn(),
  requireAdminPage: vi.fn(),
  runAfterpayConfigurationDiagnostic: vi.fn(),
}));

vi.mock("@/server/admin/admin-system-status", () => ({
  getAdminPaymentStatus: mocks.getAdminPaymentStatus,
}));
vi.mock("@/server/auth/require-admin-page", () => ({
  requireAdminPage: mocks.requireAdminPage,
}));
vi.mock("@/server/payments/afterpay-diagnostic", () => ({
  runAfterpayConfigurationDiagnostic: mocks.runAfterpayConfigurationDiagnostic,
}));

import AdminPaymentSettingsPage from "./page";

describe("Admin payment settings Afterpay diagnostic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminPage.mockResolvedValue(undefined);
    mocks.getAdminPaymentStatus.mockReturnValue({
      returnOrigin: "https://shop.example.test",
      reconciliationConfigured: true,
      localTestEnabled: false,
      providers: [{ key: "afterpay", label: "Afterpay", enabled: true, environment: "production", market: "NZ · NZD" }],
    });
    mocks.runAfterpayConfigurationDiagnostic.mockResolvedValue({
      connection: "PASS",
      crossBorderTrade: "PASS",
      australiaCountry: "PASS",
      audLimits: "PASS",
      audEligibility: "PASS",
    });
  });

  it("does not contact Afterpay until an authorized admin explicitly runs the check", async () => {
    render(await AdminPaymentSettingsPage({ searchParams: Promise.resolve({}) }));

    expect(mocks.requireAdminPage).toHaveBeenCalledWith("/admin/settings/payment", "manage_payment");
    expect(mocks.runAfterpayConfigurationDiagnostic).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Run read-only Afterpay diagnostic" })).toBeInTheDocument();
  });

  it("renders only the redacted result after an explicit check", async () => {
    render(await AdminPaymentSettingsPage({
      searchParams: Promise.resolve({ diagnose: "afterpay" }),
    }));

    expect(mocks.runAfterpayConfigurationDiagnostic).toHaveBeenCalledTimes(1);
    expect(screen.getByText("AUD checkout eligibility")).toBeInTheDocument();
    expect(screen.getAllByText("PASS")).toHaveLength(5);
    expect(document.body.textContent).not.toMatch(/merchant-id|server-secret|exchangeRate|2000\.00/);
  });

  it("blocks the diagnostic before any provider request when authorization fails", async () => {
    mocks.requireAdminPage.mockRejectedValueOnce(new Error("forbidden"));

    await expect(AdminPaymentSettingsPage({
      searchParams: Promise.resolve({ diagnose: "afterpay" }),
    })).rejects.toThrow("forbidden");
    expect(mocks.runAfterpayConfigurationDiagnostic).not.toHaveBeenCalled();
  });
});
