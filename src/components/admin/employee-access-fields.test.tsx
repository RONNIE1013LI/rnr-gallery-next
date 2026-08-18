import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { StaffAccessProfile } from "@/server/auth/staff-access-profile";
import { EmployeeAccessFields } from "./employee-access-fields";

const emptyProfile: StaffAccessProfile = {
  adminPermissions: [],
  formPermissions: {
    access_forms: false, view_jobs: false, create_jobs: false, update_jobs: false,
    delete_jobs: false, view_customer_contact: false, view_finance: false,
    update_finance: false, view_payment_proof: false, view_files: false,
    upload_files: false, delete_files: false, update_production_status: false,
    update_delivery_status: false, view_stats: false, manage_stats: false,
    export_jobs: false, manage_views: false, view_audit: false,
  },
  assignedOnly: false,
};

function PermissionEditor() {
  const [profile, setProfile] = useState<StaffAccessProfile>(emptyProfile);
  return <EmployeeAccessFields profile={profile} onChange={setProfile} />;
}

describe("EmployeeAccessFields", () => {
  it("selects the documented Admin dependencies when an individual permission is chosen", () => {
    render(<PermissionEditor />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Update order status" }));

    expect(screen.getByRole("checkbox", { name: "Update order status" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "View orders" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Administration dashboard" })).toBeChecked();
  });

  it("selects a complete group without exposing role management", () => {
    render(<PermissionEditor />);

    fireEvent.click(screen.getByRole("button", { name: "Select all Production permissions" }));

    expect(screen.getByRole("checkbox", { name: "View production jobs" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Administration dashboard" })).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: /manage staff/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /manage roles/i })).not.toBeInTheDocument();
  });

  it("keeps visible labels and supports the assigned-only Forms scope", () => {
    render(<PermissionEditor />);

    expect(screen.getByRole("group", { name: "Orders permissions" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "View production jobs" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Only assigned Forms jobs" }));
    expect(screen.getByRole("checkbox", { name: "Only assigned Forms jobs" })).toBeChecked();
  });
});
