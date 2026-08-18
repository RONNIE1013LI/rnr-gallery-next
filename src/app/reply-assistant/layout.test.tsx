import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdminPage, renderAdminShell } = vi.hoisted(() => ({
  requireAdminPage: vi.fn(),
  renderAdminShell: vi.fn(),
}));

vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/components/admin/admin-shell", () => ({
  AdminShell: (props: { administrator: unknown; children: React.ReactNode }) => {
    renderAdminShell(props);
    return <div data-testid="admin-shell">{props.children}</div>;
  },
}));

import ReplyAssistantLayout from "./layout";

describe("Reply Assistant layout", () => {
  beforeEach(() => {
    requireAdminPage.mockReset();
    requireAdminPage.mockResolvedValue({
      user: { name: "Staff Member", email: "staff@example.test" },
      adminRole: "staff",
      adminPermissions: ["access_admin", "use_reply_assistant"],
    });
  });

  it("requires the reply assistant permission and renders the admin shell", async () => {
    render(await ReplyAssistantLayout({ children: <p>Assistant content</p> }));

    expect(requireAdminPage).toHaveBeenCalledWith(
      "/reply-assistant",
      "use_reply_assistant",
    );
    expect(screen.getByTestId("admin-shell")).toHaveTextContent("Assistant content");
    expect(renderAdminShell).toHaveBeenCalledWith(expect.objectContaining({
      administrator: expect.objectContaining({
        permissions: ["access_admin", "use_reply_assistant"],
      }),
    }));
  });
});
