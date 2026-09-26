import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminShell } from "./admin-shell";

const navigation = vi.hoisted(() => ({ pathname: "/admin" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

let viewportWidth = 390;
const mediaQueries = new Map<string, MediaQueryList>();
const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");

// jsdom has no native dialog top layer. Browser acceptance covers inertness and Tab containment.
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) { this.setAttribute("open", ""); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) { this.removeAttribute("open"); },
  });
});

afterAll(() => {
  if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShowModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

function matchesViewport(query: string) {
  const minimum = query.match(/min-width:\s*([\d.]+)px/);
  const maximum = query.match(/max-width:\s*([\d.]+)px/);
  return (!minimum || viewportWidth >= Number(minimum[1]))
    && (!maximum || viewportWidth <= Number(maximum[1]));
}

function resizeViewport(width: number) {
  act(() => {
    viewportWidth = width;
    for (const media of mediaQueries.values()) {
      media.dispatchEvent(Object.assign(new Event("change"), {
        matches: media.matches,
        media: media.media,
      }));
    }
  });
}

beforeEach(() => {
  navigation.pathname = "/admin";
  viewportWidth = 390;
  mediaQueries.clear();
  vi.stubGlobal("matchMedia", (query: string) => {
    if (!mediaQueries.has(query)) {
      const events = new EventTarget();
      mediaQueries.set(query, {
        media: query,
        get matches() { return matchesViewport(query); },
        onchange: null,
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
        dispatchEvent: events.dispatchEvent.bind(events),
        addListener: (listener: EventListener) => events.addEventListener("change", listener),
        removeListener: (listener: EventListener) => events.removeEventListener("change", listener),
      } as MediaQueryList);
    }
    return mediaQueries.get(query)!;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.style.overflow = "";
  document.body.style.overflow = "";
  document.body.style.paddingRight = "";
});

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
      ["Advertising tracking", "/admin/settings/advertising"],
      ["Website Analytics", "/admin/analytics"],
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
    expect(screen.queryByRole("link", { name: "Advertising tracking" })).not.toBeInTheDocument();
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
    fireEvent.click(within(menu).getByRole("button", { name: "Content" }));
    const productsLink = within(menu).getByRole("link", { name: "Products" });
    productsLink.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(productsLink);

    expect(screen.queryByRole("navigation", { name: "Administration menu" }))
      .not.toBeInTheDocument();
  });

  it("opens one modal, focuses its close action, and restores the trigger on cancel", () => {
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
    const dialog = screen.getByRole("dialog", { name: "Administration" });
    expect(dialog).toHaveAttribute("open");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(document.body.style.overflow).toBe("hidden");
    const closeButton = screen.getByRole("button", { name: "Close administration menu" });
    expect(closeButton).toHaveFocus();

    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("navigation", { name: "Administration menu" }))
      .not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
    expect(screen.getByRole("button", { name: "Open administration menu" })).toHaveFocus();
  });

  it("closes an open menu when the persistent admin layout receives a new route", () => {
    const view = render(
      <AdminShell administrator={{ name: "Ronnie", email: "owner@example.test", role: "admin", permissions: [] }}>
        <p>Page content</p>
      </AdminShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open administration menu" }));
    expect(document.body.style.overflow).toBe("hidden");

    navigation.pathname = "/admin/orders";
    view.rerender(
      <AdminShell administrator={{ name: "Ronnie", email: "owner@example.test", role: "admin", permissions: [] }}>
        <p>New page content</p>
      </AdminShell>,
    );

    expect(screen.queryByRole("navigation", { name: "Administration menu" })).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
  });

  it("closes and unlocks an open menu during browser history navigation", () => {
    render(
      <AdminShell administrator={{ name: "Ronnie", email: "owner@example.test", role: "admin", permissions: [] }}>
        <p>Page content</p>
      </AdminShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open administration menu" }));

    fireEvent(window, new PopStateEvent("popstate"));

    expect(screen.queryByRole("navigation", { name: "Administration menu" })).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
  });

  it("closes and unlocks above 900px and stays closed when returning to mobile", () => {
    render(
      <AdminShell administrator={{ name: "Ronnie", email: "owner@example.test", role: "admin", permissions: [] }}>
        <p>Page content</p>
      </AdminShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open administration menu" }));

    resizeViewport(901);

    expect(screen.queryByRole("navigation", { name: "Administration menu" })).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
    resizeViewport(900);
    expect(screen.queryByRole("navigation", { name: "Administration menu" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open administration menu" })).toHaveAttribute("aria-expanded", "false");
  });

  it.each([
    ["/admin", "Dashboard"],
    ["/admin/", "Dashboard"],
    ["/admin/orders", "Orders"],
    ["/admin/orders/example-order", "Orders"],
    ["/admin/settings/payment", "Payment"],
    ["/admin/payment-requests/example-request", "Payment Requests"],
    ["/admin/orders-archive", null],
  ])("marks only the matching destination for %s", (pathname, activeLabel) => {
    navigation.pathname = pathname!;
    render(
      <AdminShell administrator={{ name: "Ronnie", email: "owner@example.test", role: "admin", permissions: [] }}>
        <p>Page content</p>
      </AdminShell>,
    );

    const menu = screen.getByRole("navigation", { name: "Administration" });
    const currentLinks = within(menu).queryAllByRole("link", { current: "page" });
    expect(currentLinks).toHaveLength(activeLabel ? 1 : 0);
    if (activeLabel) expect(currentLinks[0]).toHaveAccessibleName(activeLabel);
  });

  it("opens the current mobile group, lets parents toggle, and resets groups when reopened", () => {
    navigation.pathname = "/admin/orders/example-order";
    render(
      <AdminShell administrator={{ name: "Ronnie", email: "owner@example.test", role: "admin", permissions: [] }}>
        <p>Page content</p>
      </AdminShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open administration menu" }));
    let menu = screen.getByRole("navigation", { name: "Administration menu" });
    expect(within(menu).getByRole("button", { name: "Orders" })).toHaveAttribute("aria-expanded", "true");
    expect(within(menu).getByRole("link", { name: "Orders" })).toHaveAttribute("aria-current", "page");
    expect(within(menu).queryByRole("link", { name: "Products" })).not.toBeInTheDocument();
    const contentGroup = within(menu).getByRole("button", { name: "Content" });
    fireEvent.click(contentGroup);
    expect(contentGroup).toHaveAttribute("aria-expanded", "true");
    expect(within(menu).getByRole("link", { name: "Products" })).toBeInTheDocument();
    fireEvent.click(contentGroup);
    expect(contentGroup).toHaveAttribute("aria-expanded", "false");
    expect(within(menu).queryByRole("link", { name: "Products" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close administration menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Open administration menu" }));
    menu = screen.getByRole("navigation", { name: "Administration menu" });
    expect(within(menu).getByRole("button", { name: "Orders" })).toHaveAttribute("aria-expanded", "true");
    expect(within(menu).getByRole("button", { name: "Content" })).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps denied groups and destinations out of the mobile menu", () => {
    navigation.pathname = "/admin/orders";
    render(
      <AdminShell administrator={{ name: "Studio Staff", email: "staff@example.test", role: "staff", permissions: ["access_admin", "view_orders"] }}>
        <p>Page content</p>
      </AdminShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open administration menu" }));
    const menu = screen.getByRole("navigation", { name: "Administration menu" });
    expect(within(menu).getAllByRole("button")).toHaveLength(1);
    expect(within(menu).getByRole("button", { name: "Orders" })).toHaveAttribute("aria-expanded", "true");
    expect(within(menu).getAllByRole("link").map((link) => link.textContent)).toEqual(["Dashboard", "Orders"]);
    expect(within(menu).queryByRole("link", { name: "Customers" })).not.toBeInTheDocument();
  });

  it("closes a restored page and restores the original root and body scroll styles", () => {
    document.documentElement.style.overflow = "auto";
    document.body.style.overflow = "scroll";
    document.body.style.paddingRight = "7px";
    const view = render(
      <AdminShell administrator={{ name: "Ronnie", email: "owner@example.test", role: "admin", permissions: [] }}>
        <p>Page content</p>
      </AdminShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open administration menu" }));
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.body.style.paddingRight).toBe("7px");

    fireEvent(window, new PageTransitionEvent("pageshow", { persisted: true }));

    expect(screen.queryByRole("navigation", { name: "Administration menu" })).not.toBeInTheDocument();
    expect(document.documentElement.style.overflow).toBe("auto");
    expect(document.body.style.overflow).toBe("scroll");
    expect(document.body.style.paddingRight).toBe("7px");
    fireEvent.click(screen.getByRole("button", { name: "Open administration menu" }));
    view.unmount();
    expect(document.documentElement.style.overflow).toBe("auto");
    expect(document.body.style.overflow).toBe("scroll");
    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";
  });

  it.each([
    ["stable gutter", 375, "7px"],
    ["released gutter", 390, "22px"],
  ] as const)("preserves the layout width with a %s and restores the original padding", (_gutter, lockedWidth, expectedPadding) => {
    document.body.style.paddingRight = "7px";
    // Chrome's clientWidth grows after locking even when a stable gutter keeps the layout width unchanged.
    vi.spyOn(document.documentElement, "clientWidth", "get").mockImplementation(() =>
      document.documentElement.style.overflow === "hidden" ? 390 : 375,
    );
    vi.spyOn(document.documentElement, "getBoundingClientRect").mockImplementation(() =>
      new DOMRect(0, 0, document.documentElement.style.overflow === "hidden" ? lockedWidth : 375, 844),
    );
    render(
      <AdminShell administrator={{ name: "Ronnie", email: "owner@example.test", role: "admin", permissions: [] }}>
        <p>Page content</p>
      </AdminShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open administration menu" }));
    expect(document.body.style.paddingRight).toBe(expectedPadding);
    fireEvent.click(screen.getByRole("button", { name: "Close administration menu" }));
    expect(document.body.style.paddingRight).toBe("7px");
  });

  it("closes from the modal backdrop without dismissing clicks inside the menu", () => {
    render(
      <AdminShell administrator={{ name: "Ronnie", email: "owner@example.test", role: "admin", permissions: [] }}>
        <p>Page content</p>
      </AdminShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open administration menu" }));
    const dialog = screen.getByRole("dialog", { name: "Administration" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Content" }));
    expect(dialog).toBeInTheDocument();
    fireEvent.click(dialog);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open administration menu" })).toHaveFocus();
  });
});
