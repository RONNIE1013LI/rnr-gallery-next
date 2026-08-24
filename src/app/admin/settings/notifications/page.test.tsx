import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { InternalNotificationRecipientView } from "@/server/notifications/internal-notification-recipient-service";
import AdminNotificationSettingsPage, { dynamic } from "./page";

const { requireAdminPage, list, renderSettings } = vi.hoisted(() => ({
  requireAdminPage: vi.fn(),
  list: vi.fn(),
  renderSettings: vi.fn(),
}));

vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/server/notifications/internal-notification-recipient-runtime", () => ({
  getInternalNotificationRecipientRuntime: () => ({ list }),
}));
vi.mock("@/components/admin/internal-notification-settings", () => ({
  InternalNotificationSettings: (props: unknown) => {
    renderSettings(props);
    return <div>Recipient manager</div>;
  },
}));

function recipient(
  status: InternalNotificationRecipientView["status"],
  topics: InternalNotificationRecipientView["topics"],
  id: string,
): InternalNotificationRecipientView {
  return {
    id,
    email: `${status}@example.test`,
    status,
    topics,
    createdAt: new Date("2026-08-24T00:00:00.000Z"),
    verifiedAt: status === "active" ? new Date("2026-08-24T01:00:00.000Z") : null,
    verificationExpiresAt: status === "pending_verification"
      ? new Date("2026-08-25T00:00:00.000Z")
      : null,
    disabledAt: status === "disabled" ? new Date("2026-08-24T02:00:00.000Z") : null,
  };
}

describe("Admin notification settings page", () => {
  it("authorizes before loading recipients and counts only active coverage", async () => {
    requireAdminPage.mockResolvedValue({ user: { id: "admin-1" } });
    list.mockResolvedValue([
      recipient("active", ["manual_order_created", "web_order_paid"], "10000000-0000-4000-8000-000000000001"),
      recipient("pending_verification", ["payment_request_paid"], "10000000-0000-4000-8000-000000000002"),
      recipient("disabled", ["proof_approved"], "10000000-0000-4000-8000-000000000003"),
    ]);

    render(await AdminNotificationSettingsPage());

    expect(dynamic).toBe("force-dynamic");
    expect(requireAdminPage).toHaveBeenCalledWith(
      "/admin/settings/notifications",
      "manage_roles",
    );
    expect(requireAdminPage.mock.invocationCallOrder[0]).toBeLessThan(list.mock.invocationCallOrder[0]);
    expect(renderSettings).toHaveBeenCalledWith(expect.objectContaining({
      coverage: {
        manual_order_created: 1,
        web_order_paid: 1,
        payment_request_paid: 0,
        proof_approved: 0,
        proof_changes_requested: 0,
        website_ai_human_review_required: 0,
      },
    }));
    expect(screen.getByRole("heading", { name: "Notification emails" })).toBeInTheDocument();
    expect(screen.getByText("Recipient manager")).toBeInTheDocument();
  });
});
