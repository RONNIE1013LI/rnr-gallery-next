import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { normalizeStaffAccessProfile } from "@/server/auth/staff-access-profile";
import AdminEmailTemplatesPage from "./page";

const { requireAdminPage, listEmailTemplates } = vi.hoisted(() => ({
  requireAdminPage: vi.fn(),
  listEmailTemplates: vi.fn(),
}));

vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/server/admin/admin-content-runtime", () => ({
  getAdminContentRuntime: () => ({ listEmailTemplates }),
}));

const entry = Object.freeze({
  key: "email.payment_confirmed.subject",
  surface: "email" as const,
  group: "Customer payment confirmed",
  label: "Subject",
  description: "Subject sent after payment is confirmed.",
  maxLength: 200,
  multiline: false,
  defaultValue: "Payment confirmed — {{order_number}}",
  allowedVariables: ["customer_name", "order_number", "amount"],
  draftValue: "Receipt — {{order_number}}",
  publishedValue: "Payment confirmed — {{order_number}}",
  updatedAt: new Date("2026-08-16T04:00:00.000Z"),
  updatedByEmail: "owner@example.test",
});

const signatureEntry = Object.freeze({
  key: "email.signature.team_name",
  surface: "email" as const,
  group: "Customer email signature",
  label: "Team name",
  description: "Customer-facing team name.",
  maxLength: 120,
  multiline: false,
  defaultValue: "Customer Service Team",
  allowedVariables: [],
  draftValue: "Customer Service Team",
  publishedValue: "Customer Service Team",
  updatedAt: null,
  updatedByEmail: null,
});

describe("admin email templates page", () => {
  it("renders the email templates settings page for an administrator", async () => {
    requireAdminPage.mockResolvedValue({ user: { id: "admin-1" }, adminRole: "admin" });
    listEmailTemplates.mockResolvedValue([entry, signatureEntry]);

    render(await AdminEmailTemplatesPage());

    expect(requireAdminPage).toHaveBeenCalledWith(
      "/admin/settings/email-templates",
      "manage_content",
    );
    expect(screen.getByRole("heading", { name: "Email templates" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Customer payment confirmed" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Customer email signature" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Customer Service Team")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Publish" })).toHaveLength(2);
  });

  it("allows staff to draft but not publish email wording", async () => {
    requireAdminPage.mockResolvedValue({ user: { id: "staff-1" }, adminRole: "staff", adminPermissions: ["manage_content"] });
    listEmailTemplates.mockResolvedValue([entry]);

    render(await AdminEmailTemplatesPage());

    expect(screen.getByText(/Staff can save drafts/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
  });

  it("offers email publishing to Staff with the exact publish grant", async () => {
    const profile = normalizeStaffAccessProfile({
      adminPermissions: ["publish_content"],
      formPermissions: {},
      assignedOnly: false,
    });
    requireAdminPage.mockResolvedValue({ user: { id: "staff-1" }, adminRole: "staff", adminPermissions: profile.adminPermissions });
    listEmailTemplates.mockResolvedValue([entry]);

    render(await AdminEmailTemplatesPage());

    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
  });
});
