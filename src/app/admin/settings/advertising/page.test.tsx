import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AdminAdvertisingSettingsPage from "./page";

const { requireAdminPage, publicContent, renderForm } = vi.hoisted(() => ({
  requireAdminPage: vi.fn(),
  publicContent: vi.fn(),
  renderForm: vi.fn(),
}));

vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/server/admin/admin-content-runtime", () => ({
  getAdminContentRuntime: () => ({ public: publicContent }),
}));
vi.mock("@/components/admin/advertising-settings-form", () => ({
  AdvertisingSettingsForm: (props: unknown) => {
    renderForm(props);
    return <div>Advertising switch</div>;
  },
}));

describe("Admin advertising settings page", () => {
  it("authorizes publishing before reading and rendering the current switch", async () => {
    requireAdminPage.mockResolvedValue({ user: { id: "admin-1" } });
    publicContent.mockResolvedValue({ "advertising.meta.enabled": "enabled" });

    render(await AdminAdvertisingSettingsPage());

    expect(requireAdminPage).toHaveBeenCalledWith(
      "/admin/settings/advertising",
      "publish_content",
    );
    expect(requireAdminPage.mock.invocationCallOrder[0])
      .toBeLessThan(publicContent.mock.invocationCallOrder[0]);
    expect(renderForm).toHaveBeenCalledWith({ initialEnabled: true });
    expect(screen.getByRole("heading", { name: "Advertising tracking" })).toBeInTheDocument();
    expect(screen.getByText("Advertising switch")).toBeInTheDocument();
  });
});
