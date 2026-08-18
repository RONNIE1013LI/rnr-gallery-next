import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildFormAccessProfile } from "@/server/forms/forms-permissions";

import FormsPortalLayout from "./layout";

const { headers, requireFormsPage } = vi.hoisted(() => ({
  headers: vi.fn(),
  requireFormsPage: vi.fn(),
}));

vi.mock("@/server/forms/require-forms-page", () => ({ requireFormsPage }));
vi.mock("next/headers", () => ({ headers }));

describe("forms portal layout", () => {
  it("gates the workspace and projects operator capabilities into the shell", async () => {
    headers.mockResolvedValue(new Headers({
      "x-rnr-request-path": "/order-system/stats?range=30d",
    }));
    requireFormsPage.mockResolvedValue({
      user: { id: "operator-1", name: "Rosemary", email: "rosemary@example.test" },
      formRole: "form_staff",
      formProfile: buildFormAccessProfile("manager"),
    });

    render(await FormsPortalLayout({ children: <p>Protected workbench</p> }));

    expect(requireFormsPage).toHaveBeenCalledWith("/order-system/stats?range=30d", "access_forms");
    expect(screen.getByText("Protected workbench")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Order entry" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Custom stats" })).toBeInTheDocument();
  });
});
