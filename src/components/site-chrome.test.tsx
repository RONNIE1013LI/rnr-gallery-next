import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pathname: "/", search: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(state.search),
  useRouter: () => ({ replace: state.replace }),
}));
vi.mock("./site-header", () => ({ SiteHeader: () => <header>Public header</header> }));
vi.mock("./site-footer", () => ({ SiteFooter: () => <footer>Public footer</footer> }));
vi.mock("./image-protection", () => ({ ImageProtectionLayer: () => <div>Protection</div> }));

import { SiteChrome } from "./site-chrome";

describe("SiteChrome", () => {
  it.each([
    ["/", "/au"],
    ["/shop", "/au"],
    ["/canvas", "/au"],
    ["/banners", "/au"],
    ["/products/roll-up-banner/configure", "/au/products/roll-up-banner/configure"],
  ])("replaces stale NZ commerce route %s when AU is selected", async (pathname, destination) => {
    state.pathname = pathname;
    state.search = "";
    state.replace.mockClear();

    render(
      <SiteChrome
        initialMarket="AU"
        australiaEnabled
        footerContent={{ tagline: "x", email: "a@b.test", phone: "+64" }}
      >
        <main>Page</main>
      </SiteChrome>,
    );

    await waitFor(() => expect(state.replace).toHaveBeenCalledWith(destination));
  });

  it("preserves a selected gallery design while aligning an AU configure route", async () => {
    state.pathname = "/products/roll-up-banner/configure";
    state.search = "design=abc123";
    state.replace.mockClear();

    render(
      <SiteChrome
        initialMarket="AU"
        australiaEnabled
        footerContent={{ tagline: "x", email: "a@b.test", phone: "+64" }}
      >
        <main>Configure</main>
      </SiteChrome>,
    );

    await waitFor(() => expect(state.replace).toHaveBeenCalledWith(
      "/au/products/roll-up-banner/configure?design=abc123",
    ));
  });

  it("does not redirect shared information pages for the selected AU market", () => {
    state.pathname = "/help";
    state.search = "";
    state.replace.mockClear();

    render(
      <SiteChrome
        initialMarket="AU"
        australiaEnabled
        footerContent={{ tagline: "x", email: "a@b.test", phone: "+64" }}
      >
        <main>Help</main>
      </SiteChrome>,
    );

    expect(state.replace).not.toHaveBeenCalled();
  });

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
