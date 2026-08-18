import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmployeeCreateForm } from "./employee-create-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
});

describe("EmployeeCreateForm", () => {
  it("posts an exact normalized employee profile and clears the password before navigation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: { id: "employee-1" },
    }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "employee-create-0001" });
    render(<EmployeeCreateForm />);

    const password = screen.getByLabelText("Initial password");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "new-password");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Studio Employee" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "STUDIO@EXAMPLE.TEST" } });
    fireEvent.change(password, { target: { value: "long-lived-password" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Update order status" }));
    fireEvent.click(screen.getByRole("button", { name: "Create employee" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      name: "Studio Employee",
      email: "studio@example.test",
      initialPassword: "long-lived-password",
      adminPermissions: ["access_admin", "view_orders", "update_order_status"],
      assignedOnly: false,
      idempotencyKey: "employee-create-0001",
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/users/employee-1"));
    expect(password).toHaveValue("");
  });
});
