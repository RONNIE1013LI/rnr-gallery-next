import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AdminUsersPage from "./page";

const { requireAdminPage, list } = vi.hoisted(() => ({ requireAdminPage: vi.fn(), list: vi.fn() }));
vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/server/admin/admin-user-runtime", () => ({ getAdminUserRuntime: () => ({ list }) }));

describe("admin users page", () => {
  it("requires admin-only role management and shows searchable accounts", async () => {
    requireAdminPage.mockResolvedValue({ user: { id: "admin-1" }, adminRole: "admin" });
    list.mockResolvedValue({
      items: [{
        id: "user-2",
        name: "Studio User",
        email: "studio@example.test",
        emailVerified: true,
        role: "staff",
        createdAt: new Date("2026-08-04T00:00:00Z"),
        updatedAt: new Date("2026-08-04T01:00:00Z"),
        lastSeenAt: new Date("2026-08-04T02:00:00Z"),
        activeSessions: 1,
      }],
      total: 1,
      page: 1,
      pageSize: 30,
      pageCount: 1,
    });

    render(await AdminUsersPage({ searchParams: Promise.resolve({ q: "studio", role: "staff" }) }));

    expect(requireAdminPage).toHaveBeenCalledWith("/admin/users?q=studio&role=staff", "manage_roles");
    expect(screen.getByText("Studio User")).toBeInTheDocument();
    expect(screen.getByText("studio@example.test")).toBeInTheDocument();
    expect(screen.getByText("1 active session")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Role" })).toHaveValue("staff");
  });
});
