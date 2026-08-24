import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdminShell } from "./admin-shell";

describe("AdminShell", () => {
  it("renders the full operations navigation and current administrator", () => {
    render(
      <AdminShell
        administrator={{ name: "Ronnie", email: "owner@example.test", role: "admin", permissions: [] }}
      >
        <p>Page content</p>
      </AdminShell>,
    );

    expect(screen.getAllByRole("navigation", { name: "Administration" })).toHaveLength(1);
    for (const [name, href] of [
      ["Dashboard", "/admin"],
      ["Orders", "/admin/orders"],
      ["Production", "/admin/jobs"],
      ["Customers", "/admin/customers"],
      ["Users", "/admin/users"],
      ["Products", "/admin/products"],
      ["Design Gallery", "/admin/design-gallery"],
      ["Content", "/admin/content"],
      ["Customer Reviews", "/admin/customer-reviews"],
      ["Media", "/admin/media"],
      ["Shipping", "/admin/settings/shipping"],
      ["Payment", "/admin/settings/payment"],
      ["Payment Requests", "/admin/payment-requests"],
      ["Email templates", "/admin/settings/email-templates"],
      ["Notification emails", "/admin/settings/notifications"],
      ["Audit Log", "/admin/audit"],
      ["Reply Assistant", "/reply-assistant"],
    ]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
    expect(screen.getByText("owner@example.test")).toBeInTheDocument();
    expect(screen.getByText("Admin", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Page content")).toBeInTheDocument();
  });

  it("renders only the stored permissions for staff", () => {
    render(
      <AdminShell
        administrator={{
          name: "Studio Staff",
          email: "staff@example.test",
          role: "staff",
          permissions: ["access_admin", "view_orders"],
        }}
      >
        <p>Page content</p>
      </AdminShell>,
    );

    expect(screen.getByRole("link", { name: "Orders" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Production" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Design Gallery" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Email templates" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Notification emails" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Reply Assistant" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Shipping" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Payment" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Payment Requests" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Audit Log" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
  });

  it("renders only navigation groups that contain a permitted destination", () => {
    render(
      <AdminShell
        administrator={{
          name: "Studio Staff",
          email: "staff@example.test",
          role: "staff",
          permissions: ["access_admin", "view_orders"],
        }}
      >
        <p>Page content</p>
      </AdminShell>,
    );

    expect(screen.getByText("Orders", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Orders" })).toBeInTheDocument();
    expect(screen.queryByText("Production", { selector: "span" })).not.toBeInTheDocument();
    expect(screen.queryByText("Content", { selector: "span" })).not.toBeInTheDocument();
    expect(screen.queryByText("Finance", { selector: "span" })).not.toBeInTheDocument();
    expect(screen.queryByText("System", { selector: "span" })).not.toBeInTheDocument();
  });

  it("closes the mobile navigation after a destination is selected", () => {
    render(
      <AdminShell
        administrator={{ name: "Ronnie", email: "owner@example.test", role: "admin", permissions: [] }}
      >
        <p>Page content</p>
      </AdminShell>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open administration menu" }));
    const menu = screen.getByRole("navigation", { name: "Administration menu" });
    const productsLink = within(menu).getByRole("link", { name: "Products" });
    productsLink.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(productsLink);

    expect(screen.queryByRole("navigation", { name: "Administration menu" }))
      .not.toBeInTheDocument();
  });

  it("keeps mobile navigation non-modal while preserving Escape close and scroll lock", () => {
    render(
      <AdminShell
        administrator={{ name: "Ronnie", email: "owner@example.test", role: "admin", permissions: [] }}
      >
        <button type="button">Background action</button>
      </AdminShell>,
    );

    const trigger = screen.getByRole("button", { name: "Open administration menu" });
    trigger.focus();
    fireEvent.click(trigger);
    const menu = screen.getByRole("navigation", { name: "Administration menu" });
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    const auditLog = within(menu).getByRole("link", { name: "Audit Log" });
    auditLog.focus();
    expect(fireEvent.keyDown(document, { key: "Tab" })).toBe(true);

    const backgroundAction = screen.getByRole("button", { name: "Background action" });
    expect(backgroundAction).not.toHaveProperty("inert", true);
    backgroundAction.focus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("navigation", { name: "Administration menu" }))
      .not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
    expect(backgroundAction).toHaveFocus();
  });
});
