import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdminPage } = vi.hoisted(() => ({ requireAdminPage: vi.fn() }));

vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/components/admin/admin-shell", () => ({
  AdminShell: ({ children }: { children: React.ReactNode }) => <div data-testid="admin-shell">{children}</div>,
}));

import ReplyAssistantLayout from "./layout";

describe("Reply Assistant layout", () => {
  beforeEach(() => {
    requireAdminPage.mockReset();
    requireAdminPage.mockResolvedValue({
      user: { name: "Staff Member", email: "staff@example.test" },
      adminRole: "staff",
    });
  });

  it("requires the reply assistant permission and renders the admin shell", async () => {
    render(await ReplyAssistantLayout({ children: <p>Assistant content</p> }));

    expect(requireAdminPage).toHaveBeenCalledWith(
      "/reply-assistant",
      "use_reply_assistant",
    );
    expect(screen.getByTestId("admin-shell")).toHaveTextContent("Assistant content");
  });
});
