import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("./site-header", () => ({ SiteHeader: () => <header>Public header</header> }));
vi.mock("./site-footer", () => ({ SiteFooter: () => <footer>Public footer</footer> }));
vi.mock("./image-protection", () => ({ ImageProtectionLayer: () => <div>Protection</div> }));

import { SiteChrome } from "./site-chrome";

describe("SiteChrome", () => {
  it("keeps public chrome on storefront pages", () => {
    state.pathname = "/shop";
    render(<SiteChrome footerContent={{ tagline: "x", email: "a@b.test", phone: "+64" }}><main>Page</main></SiteChrome>);
    expect(screen.getByText("Public header")).toBeInTheDocument();
    expect(screen.getByText("Public footer")).toBeInTheDocument();
  });

  it("removes storefront header, footer and image protection from Admin", () => {
    state.pathname = "/admin/orders";
    render(<SiteChrome footerContent={{ tagline: "x", email: "a@b.test", phone: "+64" }}><main>Admin page</main></SiteChrome>);
    expect(screen.getByText("Admin page")).toBeInTheDocument();
    expect(screen.queryByText("Public header")).not.toBeInTheDocument();
    expect(screen.queryByText("Public footer")).not.toBeInTheDocument();
    expect(screen.queryByText("Protection")).not.toBeInTheDocument();
  });

  it("keeps the dedicated Forms portal free of storefront chrome", () => {
    state.pathname = "/order-system/jobs/job-1";
    render(<SiteChrome footerContent={{ tagline: "x", email: "a@b.test", phone: "+64" }}><main>Forms workspace</main></SiteChrome>);
    expect(screen.getByText("Forms workspace")).toBeInTheDocument();
    expect(screen.queryByText("Public header")).not.toBeInTheDocument();
    expect(screen.queryByText("Public footer")).not.toBeInTheDocument();
    expect(screen.queryByText("Protection")).not.toBeInTheDocument();
  });
});
