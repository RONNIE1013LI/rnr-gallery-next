import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pathname: "/", search: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(state.search),
  useRouter: () => ({ replace: state.replace }),
}));
vi.mock("./site-header", () => ({
  SiteHeader: ({ initialMarket = "NZ" }: { initialMarket?: string }) => (
    <header><span>Public header</span><output aria-label="Header market">{initialMarket}</output></header>
  ),
}));
vi.mock("./site-footer", () => ({
  SiteFooter: ({ market }: { market: string }) => (
    <footer><span>Public footer</span><output aria-label="Footer market">{market}</output></footer>
  ),
}));
vi.mock("./image-protection", () => ({ ImageProtectionLayer: () => <div>Protection</div> }));

import { SiteChrome } from "./site-chrome";

describe("SiteChrome", () => {
  it("keeps a fresh AU layout on NZ after the market switch event reaches the root route", async () => {
    state.pathname = "/au";
    state.search = "";
    state.replace.mockClear();
    const props = {
      initialMarket: "AU" as const,
      australiaEnabled: true,
      footerContent: { tagline: "x", email: "a@b.test", phone: "+64" },
    };
    const { rerender } = render(
      <SiteChrome {...props}><main>Australia</main></SiteChrome>,
    );

    fireEvent(window, new CustomEvent("rnr:market-changed", {
      detail: { market: "NZ" },
    }));
    state.pathname = "/";
    rerender(<SiteChrome {...props}><main>New Zealand</main></SiteChrome>);

    await waitFor(() => {
      expect(screen.getByLabelText("Header market")).toHaveTextContent("NZ");
      expect(screen.getByLabelText("Footer market")).toHaveTextContent("NZ");
      expect(state.replace).not.toHaveBeenCalled();
    });
  });

  it("keeps later NZ commerce navigation after a successful AU to NZ switch", async () => {
    state.pathname = "/au";
    state.search = "";
    state.replace.mockClear();
    const props = {
      initialMarket: "AU" as const,
      australiaEnabled: true,
      footerContent: { tagline: "x", email: "a@b.test", phone: "+64" },
    };
    const { rerender } = render(
      <SiteChrome {...props}><main>Australia</main></SiteChrome>,
    );

    fireEvent(window, new CustomEvent("rnr:market-changed", {
      detail: { market: "NZ" },
    }));
    state.pathname = "/";
    rerender(<SiteChrome {...props}><main>New Zealand</main></SiteChrome>);
    expect(screen.getByLabelText("Header market")).toHaveTextContent("NZ");

    state.pathname = "/shop";
    rerender(<SiteChrome {...props}><main>Shop</main></SiteChrome>);

    await waitFor(() => {
      expect(screen.getByLabelText("Header market")).toHaveTextContent("NZ");
      expect(screen.getByLabelText("Footer market")).toHaveTextContent("NZ");
      expect(state.replace).not.toHaveBeenCalled();
    });
  });

  it("keeps NZ commerce navigation after a successful shared-design switch", async () => {
    state.pathname = "/designs/wedding-canvas";
    state.search = "";
    state.replace.mockClear();
    const props = {
      initialMarket: "AU" as const,
      australiaEnabled: true,
      footerContent: { tagline: "x", email: "a@b.test", phone: "+64" },
    };
    const { rerender } = render(
      <SiteChrome {...props}><main>Australian design</main></SiteChrome>,
    );

    fireEvent(window, new CustomEvent("rnr:market-changed", {
      detail: { market: "NZ" },
    }));
    rerender(<SiteChrome {...props}><main>New Zealand design</main></SiteChrome>);
    expect(screen.getByLabelText("Header market")).toHaveTextContent("NZ");

    state.pathname = "/shop";
    rerender(<SiteChrome {...props}><main>Shop</main></SiteChrome>);

    await waitFor(() => {
      expect(screen.getByLabelText("Header market")).toHaveTextContent("NZ");
      expect(screen.getByLabelText("Footer market")).toHaveTextContent("NZ");
      expect(state.replace).not.toHaveBeenCalled();
    });
  });

  it("does not re-enable stale alignment after switching back to the initial market", async () => {
    state.pathname = "/au";
    state.search = "";
    state.replace.mockClear();
    const props = {
      initialMarket: "AU" as const,
      australiaEnabled: true,
      footerContent: { tagline: "x", email: "a@b.test", phone: "+64" },
    };
    const { rerender } = render(
      <SiteChrome {...props}><main>Australia</main></SiteChrome>,
    );

    fireEvent(window, new CustomEvent("rnr:market-changed", {
      detail: { market: "NZ" },
    }));
    state.pathname = "/";
    rerender(<SiteChrome {...props}><main>New Zealand</main></SiteChrome>);
    fireEvent(window, new CustomEvent("rnr:market-changed", {
      detail: { market: "AU" },
    }));
    state.pathname = "/au";
    rerender(<SiteChrome {...props}><main>Australia again</main></SiteChrome>);
    expect(screen.getByLabelText("Header market")).toHaveTextContent("AU");

    state.pathname = "/shop";
    rerender(<SiteChrome {...props}><main>NZ shop route</main></SiteChrome>);

    await waitFor(() => {
      expect(screen.getByLabelText("Header market")).toHaveTextContent("NZ");
      expect(screen.getByLabelText("Footer market")).toHaveTextContent("NZ");
      expect(state.replace).not.toHaveBeenCalled();
    });
  });

  it("updates visible chrome for an AU event without adding a replace navigation", async () => {
    state.pathname = "/";
    state.search = "";
    state.replace.mockClear();
    const props = {
      initialMarket: "NZ" as const,
      australiaEnabled: true,
      footerContent: { tagline: "x", email: "a@b.test", phone: "+64" },
    };
    const { rerender } = render(
      <SiteChrome {...props}><main>New Zealand</main></SiteChrome>,
    );

    fireEvent(window, new CustomEvent("rnr:market-changed", {
      detail: { market: "AU" },
    }));
    state.pathname = "/au";
    rerender(<SiteChrome {...props}><main>Australia</main></SiteChrome>);

    await waitFor(() => {
      expect(screen.getByLabelText("Header market")).toHaveTextContent("AU");
      expect(screen.getByLabelText("Footer market")).toHaveTextContent("AU");
      expect(state.replace).not.toHaveBeenCalled();
    });
  });

  it("derives NZ chrome from the route after NZ to AU then browser Back", async () => {
    state.pathname = "/";
    state.search = "";
    state.replace.mockClear();
    const props = {
      initialMarket: "NZ" as const,
      australiaEnabled: true,
      footerContent: { tagline: "x", email: "a@b.test", phone: "+64" },
    };
    const { rerender } = render(
      <SiteChrome {...props}><main>New Zealand</main></SiteChrome>,
    );

    fireEvent(window, new CustomEvent("rnr:market-changed", {
      detail: { market: "AU" },
    }));
    state.pathname = "/au";
    rerender(<SiteChrome {...props}><main>Australia</main></SiteChrome>);
    expect(screen.getByLabelText("Header market")).toHaveTextContent("AU");

    state.pathname = "/";
    rerender(<SiteChrome {...props}><main>New Zealand again</main></SiteChrome>);

    await waitFor(() => {
      expect(screen.getByLabelText("Header market")).toHaveTextContent("NZ");
      expect(screen.getByLabelText("Footer market")).toHaveTextContent("NZ");
      expect(state.replace).not.toHaveBeenCalled();
    });
  });

  it("derives AU chrome from the route after AU to NZ then browser Back", async () => {
    state.pathname = "/au";
    state.search = "";
    state.replace.mockClear();
    const props = {
      initialMarket: "AU" as const,
      australiaEnabled: true,
      footerContent: { tagline: "x", email: "a@b.test", phone: "+64" },
    };
    const { rerender } = render(
      <SiteChrome {...props}><main>Australia</main></SiteChrome>,
    );

    fireEvent(window, new CustomEvent("rnr:market-changed", {
      detail: { market: "NZ" },
    }));
    state.pathname = "/";
    rerender(<SiteChrome {...props}><main>New Zealand</main></SiteChrome>);
    await waitFor(() => {
      expect(screen.getByLabelText("Header market")).toHaveTextContent("NZ");
      expect(state.replace).not.toHaveBeenCalled();
    });

    state.pathname = "/au";
    rerender(<SiteChrome {...props}><main>Australia again</main></SiteChrome>);

    await waitFor(() => {
      expect(screen.getByLabelText("Header market")).toHaveTextContent("AU");
      expect(screen.getByLabelText("Footer market")).toHaveTextContent("AU");
      expect(state.replace).not.toHaveBeenCalled();
    });
  });

  it("keeps the selected AU market on a shared route after NZ to AU", async () => {
    state.pathname = "/";
    state.search = "";
    state.replace.mockClear();
    const props = {
      initialMarket: "NZ" as const,
      australiaEnabled: true,
      footerContent: { tagline: "x", email: "a@b.test", phone: "+64" },
    };
    const { rerender } = render(
      <SiteChrome {...props}><main>New Zealand</main></SiteChrome>,
    );

    fireEvent(window, new CustomEvent("rnr:market-changed", {
      detail: { market: "AU" },
    }));
    state.pathname = "/au";
    rerender(<SiteChrome {...props}><main>Australia</main></SiteChrome>);
    expect(screen.getByLabelText("Header market")).toHaveTextContent("AU");

    state.pathname = "/help";
    rerender(<SiteChrome {...props}><main>Help</main></SiteChrome>);

    await waitFor(() => {
      expect(screen.getByLabelText("Header market")).toHaveTextContent("AU");
      expect(screen.getByLabelText("Footer market")).toHaveTextContent("AU");
      expect(state.replace).not.toHaveBeenCalled();
    });
  });

  it("keeps the selected NZ market on a shared route after AU to NZ", async () => {
    state.pathname = "/au";
    state.search = "";
    state.replace.mockClear();
    const props = {
      initialMarket: "AU" as const,
      australiaEnabled: true,
      footerContent: { tagline: "x", email: "a@b.test", phone: "+64" },
    };
    const { rerender } = render(
      <SiteChrome {...props}><main>Australia</main></SiteChrome>,
    );

    fireEvent(window, new CustomEvent("rnr:market-changed", {
      detail: { market: "NZ" },
    }));
    state.pathname = "/";
    rerender(<SiteChrome {...props}><main>New Zealand</main></SiteChrome>);
    expect(screen.getByLabelText("Header market")).toHaveTextContent("NZ");

    state.pathname = "/help";
    rerender(<SiteChrome {...props}><main>Help</main></SiteChrome>);

    await waitFor(() => {
      expect(screen.getByLabelText("Header market")).toHaveTextContent("NZ");
      expect(screen.getByLabelText("Footer market")).toHaveTextContent("NZ");
      expect(state.replace).not.toHaveBeenCalled();
    });
  });

  it("keeps a same-path design switch selected on later shared routes", async () => {
    state.pathname = "/designs/wedding-canvas";
    state.search = "";
    state.replace.mockClear();
    const props = {
      initialMarket: "NZ" as const,
      australiaEnabled: true,
      footerContent: { tagline: "x", email: "a@b.test", phone: "+64" },
    };
    const { rerender } = render(
      <SiteChrome {...props}><main>Design</main></SiteChrome>,
    );

    fireEvent(window, new CustomEvent("rnr:market-changed", {
      detail: { market: "AU" },
    }));
    rerender(<SiteChrome {...props}><main>Australian design</main></SiteChrome>);
    await waitFor(() => {
      expect(screen.getByLabelText("Header market")).toHaveTextContent("AU");
      expect(state.replace).not.toHaveBeenCalled();
    });

    state.pathname = "/help";
    rerender(<SiteChrome {...props}><main>Help</main></SiteChrome>);
    await waitFor(() => {
      expect(screen.getByLabelText("Header market")).toHaveTextContent("AU");
      expect(screen.getByLabelText("Footer market")).toHaveTextContent("AU");
      expect(state.replace).not.toHaveBeenCalled();
    });

    state.pathname = "/designs/wedding-canvas";
    rerender(<SiteChrome {...props}><main>Design again</main></SiteChrome>);
    expect(screen.getByLabelText("Header market")).toHaveTextContent("AU");
  });

  it.each([
    "/",
    "/shop",
    "/canvas",
    "/banners",
    "/products/roll-up-banner/configure",
  ])("never performs late client geo alignment on %s", (pathname) => {
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

    expect(state.replace).not.toHaveBeenCalled();
  });

  it("leaves query-preserving market alignment to the request proxy", () => {
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

    expect(state.replace).not.toHaveBeenCalled();
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

  it("keeps Reply Assistant inside the dedicated Admin workspace chrome", () => {
    state.pathname = "/reply-assistant";
    render(
      <SiteChrome
        footerContent={{ tagline: "x", email: "a@b.test", phone: "+64" }}
        footerLead={<section aria-label="Customer reviews">Shared reviews</section>}
      >
        <main>Reply Assistant workspace</main>
      </SiteChrome>,
    );
    expect(screen.getByText("Reply Assistant workspace")).toBeInTheDocument();
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
