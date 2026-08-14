import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserRoleControl } from "./user-role-control";

afterEach(() => vi.unstubAllGlobals());

describe("UserRoleControl", () => {
  it("saves a changed role and announces success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: { id: "user-2", role: "staff", changed: true },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "role-change-0001" });
    render(<UserRoleControl userId="user-2" email="studio@example.test" currentRole="customer" />);

    fireEvent.change(screen.getByRole("combobox", { name: "Role for studio@example.test" }), {
      target: { value: "staff" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save role for studio@example.test" }));

    await waitFor(() => expect(screen.getByText("Role updated.")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/users/user-2", expect.objectContaining({ method: "PATCH" }));
  });

  it("does not allow the current administrator to edit their own role", () => {
    render(<UserRoleControl userId="admin-1" email="owner@example.test" currentRole="admin" disabled />);
    expect(screen.getByRole("combobox", { name: "Role for owner@example.test" })).toBeDisabled();
    expect(screen.getByText("Current account")).toBeInTheDocument();
  });

  it("requires a form access profile when assigning form-only staff", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: {
        id: "user-2",
        role: "form_staff",
        formPreset: "artist",
        changed: true,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "role-change-form-staff-0001" });
    render(<UserRoleControl
      userId="user-2"
      email="artist@example.test"
      currentRole="customer"
      currentFormPreset={null}
    />);

    fireEvent.change(screen.getByRole("combobox", { name: "Role for artist@example.test" }), {
      target: { value: "form_staff" },
    });
    expect(screen.getByRole("combobox", { name: "Forms profile for artist@example.test" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Forms profile for artist@example.test" }), {
      target: { value: "artist" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save role for artist@example.test" }));

    await waitFor(() => expect(screen.getByText("Role updated.")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/users/user-2",
      expect.objectContaining({
        body: JSON.stringify({
          role: "form_staff",
          formPreset: "artist",
          idempotencyKey: "role-change-form-staff-0001",
        }),
      }),
    );
  });
});
