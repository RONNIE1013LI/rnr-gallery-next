import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminPromotionsSettingsPage from "./page";
import AdminSettingsPage from "../page";

const { requireAdminPage, getThankYouOfferState } = vi.hoisted(() => ({
  requireAdminPage: vi.fn(), getThankYouOfferState: vi.fn(),
}));
vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/server/promotions/thank-you-offer-state", () => ({ getThankYouOfferState }));

beforeEach(() => {
  vi.resetAllMocks();
  requireAdminPage.mockResolvedValue({ user: { id: "admin-1" } });
});

describe("promotion settings page", () => {
  it.each([true, false])("renders the authoritative %s state after both permission checks", async (enabled) => {
    getThankYouOfferState.mockResolvedValue(enabled);
    render(await AdminPromotionsSettingsPage());
    expect(requireAdminPage).toHaveBeenCalledWith("/admin/settings/promotions", "manage_content");
    expect(requireAdminPage).toHaveBeenCalledWith("/admin/settings/promotions", "publish_content");
    expect(screen.getByRole("switch", { name: "Anniversary promotion" })).toHaveProperty("checked", enabled);
  });

  it.each(["manage_content", "publish_content"])("does not read or display settings without %s", async (permission) => {
    requireAdminPage.mockImplementation(async (_path, requested) => {
      if (requested === permission) throw new Error("Not permitted");
    });
    await expect(AdminPromotionsSettingsPage()).rejects.toThrow("Not permitted");
    expect(getThankYouOfferState).not.toHaveBeenCalled();
  });

  it("shows unavailable without any editable or enabled fallback after a failed read", async () => {
    getThankYouOfferState.mockRejectedValue(new Error("Database unavailable"));
    render(await AdminPromotionsSettingsPage());
    expect(screen.getByRole("alert")).toHaveTextContent("Promotion setting is unavailable");
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByText("Enabled")).not.toBeInTheDocument();
  });

  it("links Promotions separately from Advertising in settings", async () => {
    render(await AdminSettingsPage());
    expect(screen.getByRole("link", { name: /Promotions/ })).toHaveAttribute("href", "/admin/settings/promotions");
    expect(screen.getByRole("link", { name: /Advertising/ })).toHaveAttribute("href", "/admin/settings/advertising");
  });
});
