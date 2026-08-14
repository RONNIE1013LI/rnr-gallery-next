import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AdminAuditPage from "./page";

const { requireAdminPage, list } = vi.hoisted(() => ({ requireAdminPage: vi.fn(), list: vi.fn() }));
vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/server/admin/admin-audit-runtime", () => ({ getAdminAuditRuntime: () => ({ list }) }));

describe("admin audit page", () => {
  it("renders sanitized audit summaries", async () => {
    requireAdminPage.mockResolvedValue({ user: { id: "admin-1" }, adminRole: "admin" });
    list.mockResolvedValue({ items: [{ id: "audit-1", actorEmail: "admin@example.test", action: "content.published", resourceType: "content", resourceId: "home.hero.title", result: "success", beforeSummary: { value: "Old" }, afterSummary: { value: "New" }, requestSource: "direct", createdAt: new Date("2026-08-04T01:00:00Z") }], total: 1, page: 1, pageSize: 50, pageCount: 1 });
    render(await AdminAuditPage({ searchParams: Promise.resolve({}) }));
    expect(requireAdminPage).toHaveBeenCalledWith("/admin/audit", "view_audit");
    expect(screen.getByText("content.published")).toBeInTheDocument();
    expect(screen.getByText(/home.hero.title/)).toBeInTheDocument();
  });
});
