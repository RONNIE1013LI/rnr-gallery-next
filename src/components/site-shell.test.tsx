import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

const { usePathname } = vi.hoisted(() => ({
  usePathname: vi.fn(() => "/"),
}));

vi.mock("next/navigation", () => ({ usePathname }));

describe("site shell", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/");
    localStorage.clear();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  });

  it("offers the main storefront routes", () => {
    render(<SiteHeader />);

    expect(screen.getByRole("banner")).toHaveClass("site-header--sticky");
    const homeLink = screen.getByRole("link", { name: /r&r gallery/i });
    expect(homeLink).toHaveAttribute(
      "href",
      "/",
    );
    expect(decodeURIComponent(homeLink.querySelector("img")?.getAttribute("src") ?? ""))
      .toContain("/media/brand/rr-gallery-logo-2026.webp");
    expect(screen.getByRole("navigation", { name: /primary/i })).toBeVisible();
    expect(screen.getAllByRole("link", { name: "Shop" })[0]).toHaveAttribute(
      "href",
      "/shop",
    );
    const shopMenu = screen.getByRole("navigation", { name: "Shop menu" });
    expect(within(shopMenu).getByRole("link", { name: "All products" }))
      .toHaveAttribute("href", "/shop");
    expect(within(shopMenu).getByRole("link", { name: "Canvas" }))
      .toHaveAttribute("href", "/canvas");
    expect(within(shopMenu).getByRole("link", { name: "Banners" }))
      .toHaveAttribute("href", "/banners");

    expect(screen.getAllByRole("link", { name: "Design Gallery" })[0]).toHaveAttribute(
      "href",
      "/design-gallery",
    );
    const galleryMenu = screen.getByRole("navigation", { name: "Design Gallery menu" });
    expect(within(galleryMenu).getByRole("link", { name: "All designs" }))
      .toHaveAttribute("href", "/design-gallery");
    expect(within(galleryMenu).getByRole("link", { name: "Designs by product" }))
      .toHaveAttribute("href", "/#gallery");
    expect(within(galleryMenu).getByRole("link", { name: "Browse by occasion" }))
      .toHaveAttribute("href", "/design-gallery?filters=1#browse-by-occasion");
    expect(within(galleryMenu).getByRole("link", { name: "Transformations" }))
      .toHaveAttribute("href", "/#transformation");
    expect(screen.getAllByRole("link", { name: "How It Works" })[0]).toHaveAttribute(
      "href",
      "/#process",
    );
    expect(screen.getAllByRole("link", { name: "Help" })[0]).toHaveAttribute(
      "href",
      "/#faq",
    );
    expect(screen.getAllByRole("link", { name: "Start a Design" })[0]).toHaveAttribute(
      "href",
      "/shop",
    );
    expect(within(shopMenu).getByRole("link", { name: "Canvas" })).toBeInTheDocument();
    expect(within(shopMenu).getByRole("link", { name: "Banners" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /cart/i })).toHaveAttribute(
      "href",
      "/cart",
    );
    expect(screen.getByText("Menu")).toBeInTheDocument();
  });

  it("marks the current primary navigation destination", () => {
    usePathname.mockReturnValue("/design-gallery");
    render(<SiteHeader />);

    expect(screen.getAllByRole("link", { name: "Design Gallery" })[0]).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getAllByRole("link", { name: "Shop" })[0]).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("closes a focused desktop submenu when another menu is hovered", () => {
    render(<SiteHeader />);

    const shopLink = screen.getAllByRole("link", { name: "Shop" })[0];
    const galleryLink = screen.getAllByRole("link", { name: "Design Gallery" })[0];
    const galleryGroup = galleryLink.closest<HTMLDivElement>(".site-header__nav-group")!;

    shopLink.focus();
    expect(shopLink).toHaveFocus();

    fireEvent.mouseEnter(galleryGroup);

    expect(shopLink).not.toHaveFocus();
  });

  it("dismisses a desktop submenu immediately after one of its links is selected", () => {
    render(<SiteHeader />);

    const shopMenu = screen.getByRole("navigation", { name: "Shop menu" });
    const shopGroup = shopMenu.closest<HTMLDivElement>(".site-header__nav-group")!;
    const allProducts = within(shopMenu).getByRole("link", { name: "All products" });

    allProducts.focus();
    fireEvent.click(allProducts);

    expect(allProducts).not.toHaveFocus();
    expect(shopMenu).toHaveAttribute("aria-hidden", "true");

    fireEvent.mouseLeave(shopGroup);
    expect(shopMenu).not.toHaveAttribute("aria-hidden");
  });

  it("marks a parent destination for nested routes", () => {
    usePathname.mockReturnValue("/account/sign-in");
    render(<SiteHeader />);

    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    const mobileMenu = screen.getByRole("button", { name: "Close navigation menu" })
      .closest<HTMLDivElement>(".mobile-menu")!;
    expect(within(mobileMenu).getByRole("link", { name: "Account" }))
      .toHaveAttribute("aria-current", "page");
  });

  it("applies the sticky header scroll state only after the page is scrolled", () => {
    render(<SiteHeader />);
    const header = screen.getByRole("banner");

    expect(header).not.toHaveClass("site-header--scrolled");

    Object.defineProperty(window, "scrollY", { configurable: true, value: 24 });
    fireEvent.scroll(window);
    expect(header).toHaveClass("site-header--scrolled");

    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    fireEvent.scroll(window);
    expect(header).not.toHaveClass("site-header--scrolled");
  });

  it("shows the persisted cart quantity", () => {
    localStorage.setItem(
      "rnr-cart-v1",
      JSON.stringify({
        version: 1,
        items: [{
          id: "item",
          productKey: "photo-print-canvas",
          productSlug: "photo-print-canvas",
          productTitle: "Photo Print Canvas",
          imageSrc: "/media/home/family-canvas.webp",
          sizeKey: "a4",
          sizeLabel: "A4",
          peoplePets: 0,
          photoSubmissionMethod: "later",
          designText: "",
          notes: "",
          neededDate: "2026-08-10",
          deliveryPreference: "post",
          quantity: 2,
          price: { lines: [], subtotalExGstCents: 6500, gstCents: 975, totalInclGstCents: 7475 },
          uploadReferences: [],
        }],
      }),
    );
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: "Cart, 2 items" })).toBeInTheDocument();
  });

  it("provides a cart icon and a four-line mobile menu icon", () => {
    render(<SiteHeader />);

    expect(screen.getByRole("link", { name: "Cart, 0 items" })
      .querySelector(".site-header__cart-icon")).toBeInTheDocument();
    expect(document.querySelectorAll(".mobile-menu__icon-line")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    expect(screen.getByRole("navigation", { name: "Mobile navigation" }))
      .toHaveClass("mobile-menu__drawer");
  });

  it("closes the mobile menu after a navigation link is selected", () => {
    render(<SiteHeader />);

    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    const menu = screen.getByRole("button", { name: "Close navigation menu" })
      .closest<HTMLDivElement>(".mobile-menu")!;
    fireEvent.click(within(menu).getByRole("link", { name: "Transformations" }));

    expect(screen.queryByRole("navigation", { name: "Mobile navigation" }))
      .not.toBeInTheDocument();
  });

  it("includes Home in the mobile menu and closes it for header links", () => {
    render(<SiteHeader />);

    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    const menu = screen.getByRole("button", { name: "Close navigation menu" })
      .closest<HTMLDivElement>(".mobile-menu")!;
    expect(within(menu).getByRole("link", { name: "Home" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(within(menu).getByRole("link", { name: "Start a Design" })).toHaveAttribute(
      "href",
      "/shop",
    );

    fireEvent.click(document.querySelector<HTMLAnchorElement>(".site-header__brand")!);
    expect(screen.queryByRole("navigation", { name: "Mobile navigation" }))
      .not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    fireEvent.click(document.querySelector<HTMLAnchorElement>(".site-header__cart")!);
    expect(screen.queryByRole("navigation", { name: "Mobile navigation" }))
      .not.toBeInTheDocument();
  });

  it("shows a clear close state and closes from the menu backdrop", () => {
    vi.useFakeTimers();
    render(<SiteHeader />);

    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    const menu = screen.getByRole("button", { name: "Close navigation menu" })
      .closest<HTMLDivElement>(".mobile-menu")!;

    expect(screen.getByRole("banner")).toHaveClass("site-header--menu-open");
    expect(screen.getByText("Close")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close mobile navigation" }))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close mobile navigation" }));

    expect(menu).toHaveClass("mobile-menu--closing");
    expect(screen.getByRole("navigation", { name: "Mobile navigation" })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(180));

    expect(screen.queryByRole("navigation", { name: "Mobile navigation" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("banner")).not.toHaveClass("site-header--menu-open");
    expect(screen.getByText("Menu")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("keeps the mobile menu non-modal without changing document scroll state", () => {
    vi.useFakeTimers();
    render(
      <>
        <SiteHeader />
        <button type="button">Background action</button>
      </>,
    );

    const trigger = screen.getByRole("button", { name: "Open navigation menu" });
    trigger.focus();
    fireEvent.click(trigger);
    const menu = screen.getByRole("button", { name: "Close navigation menu" })
      .closest<HTMLDivElement>(".mobile-menu")!;

    expect(document.body.style.overflow).toBe("");
    expect(document.body.style.paddingRight).toBe("");
    expect(trigger).toHaveFocus();

    const account = within(menu).getByRole("link", { name: "Account" });
    account.focus();
    expect(fireEvent.keyDown(document, { key: "Tab" })).toBe(true);

    const backgroundAction = screen.getByRole("button", { name: "Background action" });
    expect(backgroundAction).not.toHaveProperty("inert", true);
    backgroundAction.focus();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(menu).toHaveClass("mobile-menu--closing");
    act(() => vi.advanceTimersByTime(180));

    expect(screen.queryByRole("navigation", { name: "Mobile navigation" }))
      .not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
    expect(document.body.style.paddingRight).toBe("");
    expect(backgroundAction).toHaveFocus();
    vi.useRealTimers();
  });

  it("keeps support and legal links in the footer", () => {
    render(<SiteFooter />);
    const footer = screen.getByRole("contentinfo");

    const helpMenu = footer.querySelector<HTMLElement>(".site-footer__help-menu");
    expect(helpMenu).toBeInTheDocument();
    const contact = footer.querySelector<HTMLElement>(".site-footer__contact");
    expect(contact).toBeInTheDocument();
    expect(helpMenu).toContainElement(contact);

    expect(within(footer).getByRole("link", { name: /message r&r/i })).toBeVisible();
    expect(within(contact!).getByRole("link", { name: /\+64 21 023 48948/i })).toBeVisible();
    const email = within(contact!).getByRole("link", {
      name: "customerservice@rnrgallery.com",
    });
    expect(email).toBeVisible();
    expect(email).toHaveAttribute("href", "mailto:customerservice@rnrgallery.com");
    expect(contact).toContainElement(email);
    expect(within(footer).getAllByRole("link", { name: /privacy/i }))
      .toHaveLength(1);
    expect(within(footer).getByRole("link", { name: "Designs by Product" }))
      .toHaveAttribute("href", "/#gallery");
    expect(within(footer).getByRole("link", { name: "Transformations" }))
      .toHaveAttribute("href", "/#transformation");
    expect(within(footer).getByRole("link", { name: "FAQ" }))
      .toHaveAttribute("href", "/#faq");
  });

  it("places policies under Customer and links the footer brand to the page top", () => {
    render(<><SiteHeader /><SiteFooter /></>);
    const footer = screen.getByRole("contentinfo");
    const customerColumn = within(footer).getByText("Customer").parentElement!;
    const legalRow = footer.querySelector<HTMLElement>(".site-footer__legal")!;

    expect(document.querySelector("#top")).toHaveClass("page-top-anchor");
    expect(screen.getByRole("banner")).not.toHaveAttribute("id");
    const footerBrand = within(footer).getByRole("link", { name: "R&R Gallery" });
    expect(footerBrand).toHaveAttribute("href", "#top");
    expect(decodeURIComponent(footerBrand.querySelector("img")?.getAttribute("src") ?? ""))
      .toContain("/media/brand/rr-gallery-logo-2026.webp");
    expect(within(footer).queryByRole("navigation", { name: "Footer policies" }))
      .not.toBeInTheDocument();
    expect(within(customerColumn).getByRole("link", { name: "Privacy" }))
      .toHaveAttribute("href", "/privacy");
    expect(within(customerColumn).getByRole("link", { name: "Terms" }))
      .toHaveAttribute("href", "/terms");
    expect(within(legalRow).queryByRole("navigation", {
      name: "Mobile footer policies",
    })).not.toBeInTheDocument();
    const copyright = within(legalRow).getByText("© 2026 R&R Gallery");
    expect(copyright).toHaveClass("site-footer__copyright");
    expect(copyright).toHaveStyle({
      width: "100%",
      display: "block",
      margin: "0 auto",
      textAlign: "center",
    });
  });

  it("renders published managed footer contact content", () => {
    render(<SiteFooter content={{
      tagline: "Managed canvas and banner services.",
      email: "studio@example.test",
      phone: "+64 9 555 0100",
    }} />);
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByText("Managed canvas and banner services.")).toBeInTheDocument();
    expect(within(footer).getByRole("link", { name: "studio@example.test" })).toHaveAttribute("href", "mailto:studio@example.test");
    expect(within(footer).getByRole("link", { name: "+64 9 555 0100" })).toHaveAttribute("href", "tel:+6495550100");
  });
});
