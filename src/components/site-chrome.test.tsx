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
    ["/shop", "/au/shop"],
    ["/canvas", "/au/canvas"],
    ["/banners", "/au/banners"],
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

  it.each([
    "/shop",
    "/canvas",
    "/banners",
    "/products/roll-up-banner",
    "/products/roll-up-banner/configure",
    "/design-gallery",
    "/cart",
    "/help",
    "/contact",
    "/about",
    "/terms",
    "/privacy",
    "/shipping-delivery",
    "/au/shop",
    "/au/products/roll-up-banner",
  ])("renders the shared reviews immediately before the public footer on %s", (pathname) => {
    state.pathname = pathname;
    const { container } = render(
      <SiteChrome
        footerContent={{ tagline: "x", email: "a@b.test", phone: "+64" }}
        footerLead={<section aria-label="Customer reviews">Shared reviews</section>}
      >
        <main>Page content</main>
      </SiteChrome>,
    );

    const page = screen.getByText("Page content");
    const reviews = screen.getByRole("region", { name: "Customer reviews" });
    const footer = screen.getByText("Public footer");

    expect(container.textContent).toContain("Page contentShared reviewsPublic footer");
    expect(page.compareDocumentPosition(reviews) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(reviews.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each(["/", "/au"])("does not duplicate the homepage reviews on %s", (pathname) => {
    state.pathname = pathname;
    render(
      <SiteChrome
        footerContent={{ tagline: "x", email: "a@b.test", phone: "+64" }}
        footerLead={<section aria-label="Customer reviews">Shared reviews</section>}
      >
        <main><section aria-label="Customer reviews">Homepage reviews</section></main>
      </SiteChrome>,
    );

    expect(screen.getAllByRole("region", { name: "Customer reviews" })).toHaveLength(1);
    expect(screen.getByText("Homepage reviews")).toBeInTheDocument();
    expect(screen.queryByText("Shared reviews")).not.toBeInTheDocument();
  });

  it.each([
    "/account",
    "/account/orders",
    "/account/sign-in",
    "/checkout",
    "/checkout/start",
    "/orders/RNR-8000",
    "/pay/private-token",
    "/reply-assistant",
  ])("keeps shared reviews out of private or transactional route %s", (pathname) => {
    state.pathname = pathname;
    render(
      <SiteChrome
        footerContent={{ tagline: "x", email: "a@b.test", phone: "+64" }}
        footerLead={<section aria-label="Customer reviews">Shared reviews</section>}
      >
        <main>Private flow</main>
      </SiteChrome>,
    );

    expect(screen.queryByText("Shared reviews")).not.toBeInTheDocument();
    expect(screen.getByText("Public footer")).toBeInTheDocument();
  });

  it("leaves no reviews wrapper when the safe public review data is empty", () => {
    state.pathname = "/shop";
    render(
      <SiteChrome
        footerContent={{ tagline: "x", email: "a@b.test", phone: "+64" }}
        footerLead={null}
      >
        <main>Page</main>
      </SiteChrome>,
    );

    expect(screen.queryByRole("region", { name: "Customer reviews" })).not.toBeInTheDocument();
    expect(screen.getByText("Public footer")).toBeInTheDocument();
  });

  it("mounts the customer chat only when the server-provided Website flag is enabled", () => {
    state.pathname = "/shop";
    const page = <main>Page</main>;
    const first = render(<SiteChrome customerChatEnabled={false} footerContent={{ tagline: "x", email: "a@b.test", phone: "+64" }}>{page}</SiteChrome>);
    expect(screen.queryByRole("button", { name: "Chat with R&R Gallery" })).not.toBeInTheDocument();

    first.unmount();
    render(<SiteChrome customerChatEnabled footerContent={{ tagline: "x", email: "a@b.test", phone: "+64" }}>{page}</SiteChrome>);
    expect(screen.getByRole("button", { name: "Chat with R&R Gallery" })).toBeInTheDocument();
  });

  it.each([
    "/admin/orders",
    "/reply-assistant",
    "/forms/orders",
    "/order-system/jobs/job-1",
    "/checkout",
    "/payment/return",
    "/account/sign-in",
    "/orders/order-1",
    "/proofs/proof-1",
    "/privacy",
    "/privacy-policy",
    "/privacy-policy/subpage",
    "/pay/secure-token",
    "/pay/secure-token/return",
  ])("never mounts customer chat on excluded route %s", (pathname) => {
    state.pathname = pathname;
    render(<SiteChrome customerChatEnabled footerContent={{ tagline: "x", email: "a@b.test", phone: "+64" }}><main>Restricted page</main></SiteChrome>);
    expect(screen.queryByRole("button", { name: "Chat with R&R Gallery" })).not.toBeInTheDocument();
  });

  it.each(["/privacy-policy", "/pay/secure-token"]) (
    "keeps storefront chrome while excluding customer chat from %s",
    (pathname) => {
      state.pathname = pathname;
      render(<SiteChrome customerChatEnabled footerContent={{ tagline: "x", email: "a@b.test", phone: "+64" }}><main>Protected public page</main></SiteChrome>);
      expect(screen.getByText("Public header")).toBeInTheDocument();
      expect(screen.getByText("Public footer")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Chat with R&R Gallery" })).not.toBeInTheDocument();
    },
  );

  it("removes storefront header, footer and image protection from Admin", () => {
    state.pathname = "/admin/orders";
    render(
      <SiteChrome
        footerContent={{ tagline: "x", email: "a@b.test", phone: "+64" }}
        footerLead={<section aria-label="Customer reviews">Shared reviews</section>}
      >
        <main>Admin page</main>
      </SiteChrome>,
    );
    expect(screen.getByText("Admin page")).toBeInTheDocument();
    expect(screen.queryByText("Shared reviews")).not.toBeInTheDocument();
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
