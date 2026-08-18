import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminUserAccount } from "@/server/admin/admin-user-service";
import { EmployeeAccessForm } from "./employee-access-form";

const staffAccount: AdminUserAccount = {
  id: "employee-1", name: "Studio Employee", email: "studio@example.test", emailVerified: false,
  role: "staff", formPreset: null, adminPermissions: ["access_admin", "view_orders"],
  formPermissions: {
    access_forms: false, view_jobs: false, create_jobs: false, update_jobs: false,
    delete_jobs: false, view_customer_contact: false, view_finance: false,
    update_finance: false, view_payment_proof: false, view_files: false,
    upload_files: false, delete_files: false, update_production_status: false,
    update_delivery_status: false, view_stats: false, manage_stats: false,
    export_jobs: false, manage_views: false, view_audit: false,
  },
  assignedOnly: false, createdAt: new Date("2026-08-18T00:00:00Z"), updatedAt: new Date("2026-08-18T00:00:00Z"),
};

afterEach(() => vi.unstubAllGlobals());

describe("EmployeeAccessForm", () => {
  it("updates a Staff profile with the exact PATCH DTO", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: { id: "employee-1", role: "staff", changed: true },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "employee-access-0001" });
    render(<EmployeeAccessForm account={staffAccount} currentUserId="admin-1" />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Update order status" }));
    fireEvent.click(screen.getByRole("button", { name: "Save employee access" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      role: "staff",
      adminPermissions: ["access_admin", "view_orders", "update_order_status"],
      assignedOnly: false,
      idempotencyKey: "employee-access-0001",
    });
  });

  it("locks the signed-in administrator and shows Admin access as read-only", () => {
    render(<EmployeeAccessForm account={{ ...staffAccount, id: "admin-1", role: "admin", adminPermissions: null, formPermissions: null, assignedOnly: null }} currentUserId="admin-1" />);

    expect(screen.getByText("Current account — access is locked.")).toBeInTheDocument();
    expect(screen.getByText("Full access to all Admin and Forms permissions.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Account type" })).toBeDisabled();
  });

  it("keeps the existing Forms preset selected", () => {
    render(<EmployeeAccessForm account={{ ...staffAccount, role: "form_staff", formPreset: "artist", adminPermissions: null, formPermissions: null, assignedOnly: null }} currentUserId="admin-1" />);

    expect(screen.getByRole("combobox", { name: "Forms profile" })).toHaveValue("artist");
  });

  it("restores dependency permissions before rendering a stored Staff profile", () => {
    render(<EmployeeAccessForm account={{ ...staffAccount, adminPermissions: ["view_orders"] }} currentUserId="admin-1" />);

    expect(screen.getByRole("checkbox", { name: "View orders" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Administration dashboard" })).toBeChecked();
  });
});
