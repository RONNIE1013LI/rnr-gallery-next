import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AdminContentPage from "./page";

const { requireAdminPage, list } = vi.hoisted(() => ({
  requireAdminPage: vi.fn(),
  list: vi.fn(),
}));
vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/server/admin/admin-content-runtime", () => ({
  getAdminContentRuntime: () => ({ list }),
}));

describe("admin content page", () => {
  it("renders real drafts grouped by content area and allows admins to publish", async () => {
    requireAdminPage.mockResolvedValue({ user: { id: "admin-1" }, adminRole: "admin" });
    list.mockResolvedValue([{
      key: "home.hero.title",
      group: "Homepage",
      label: "Hero title",
      description: "Primary homepage heading.",
      maxLength: 200,
      multiline: false,
      defaultValue: "Art made from your story.",
      draftValue: "A refined story headline",
      publishedValue: "Art made from your story.",
      updatedAt: new Date("2026-08-04T03:00:00.000Z"),
      updatedByEmail: "owner@example.test",
    }]);

    render(await AdminContentPage());
    expect(requireAdminPage).toHaveBeenCalledWith("/admin/content", "manage_content");
    expect(screen.getByRole("heading", { name: "Content" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Homepage" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("A refined story headline")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
    expect(screen.getByText("Live: Art made from your story.")).toBeInTheDocument();
  });

  it("does not offer publishing to staff", async () => {
    requireAdminPage.mockResolvedValue({ user: { id: "staff-1" }, adminRole: "staff" });
    list.mockResolvedValue([]);
    render(await AdminContentPage());
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(screen.getByText(/Staff can save drafts/)).toBeInTheDocument();
  });
});
