import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generatedSrcsetDescriptors } from "@/test/image-candidate-assertions";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

const { usePathname, push, refresh } = vi.hoisted(() => ({
  usePathname: vi.fn(() => "/"),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ usePathname, useRouter: () => ({ push, refresh }) }));

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
    expect(homeLink.querySelector("img")).toHaveAttribute("width", "96");
    expect(homeLink.querySelector("img")).toHaveAttribute("height", "96");
    expect(homeLink.querySelector("img")).not.toHaveAttribute("sizes");
    expect(generatedSrcsetDescriptors(homeLink.querySelector("img")!)).toEqual(["1x", "2x"]);
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
      "/how-it-works",
    );
    expect(screen.getAllByRole("link", { name: "Help" })[0]).toHaveAttribute(
      "href",
      "/help",
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
    expect(screen.getByRole("combobox", { name: "Country and currency" })).toHaveValue("NZ");
    expect(screen.getByRole("option", { name: "Australia — AUD" })).toBeDisabled();
  });

  it("keeps every storefront navigation entry on Australian pricing", () => {
    usePathname.mockReturnValue("/au");
    render(<><SiteHeader initialMarket="AU" australiaEnabled /><SiteFooter market="AU" /></>);

    expect(screen.getByRole("link", { name: /r&r gallery.*home/i }))
      .toHaveAttribute("href", "/au");
    expect(screen.getAllByRole("link", { name: "Shop" })[0])
      .toHaveAttribute("href", "/au/shop");
    expect(screen.getAllByRole("link", { name: "Start a Design" })[0])
      .toHaveAttribute("href", "/au/shop");

    const shopMenu = screen.getByRole("navigation", { name: "Shop menu" });
    expect(within(shopMenu).getByRole("link", { name: "All products" }))
      .toHaveAttribute("href", "/au/shop");
    expect(within(shopMenu).getByRole("link", { name: "Canvas" }))
      .toHaveAttribute("href", "/au/canvas");
    expect(within(shopMenu).getByRole("link", { name: "Banners" }))
      .toHaveAttribute("href", "/au/banners");

    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    const mobileMenu = screen.getByRole("navigation", { name: "Mobile navigation" });
    expect(within(mobileMenu).getByRole("link", { name: "Home" }))
      .toHaveAttribute("href", "/au");
    expect(within(mobileMenu).getByRole("link", { name: "Shop" }))
      .toHaveAttribute("href", "/au/shop");
    expect(within(mobileMenu).getByRole("link", { name: "Canvas" }))
      .toHaveAttribute("href", "/au/canvas");
    expect(within(mobileMenu).getByRole("link", { name: "Banners" }))
      .toHaveAttribute("href", "/au/banners");

    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "All products" }))
      .toHaveAttribute("href", "/au/shop");
    expect(within(footer).getByRole("link", { name: "Canvas" }))
      .toHaveAttribute("href", "/au/canvas");
    expect(within(footer).getByRole("link", { name: "Banners" }))
      .toHaveAttribute("href", "/au/banners");
  });

  it("groups Cart with the storefront shopping links", () => {
    render(<SiteFooter />);

    const footer = screen.getByRole("contentinfo");
    const shop = footer.querySelector<HTMLElement>(".site-footer__shop")!;
    const customer = footer.querySelector<HTMLElement>(".site-footer__customer")!;

    expect(within(shop).getByRole("link", { name: "Cart" }))
      .toHaveAttribute("href", "/cart");
    expect(within(customer).queryByRole("link", { name: "Cart" }))
      .not.toBeInTheDocument();
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

  it("hides while scrolling down and returns while scrolling toward the page top", () => {
    render(<SiteHeader />);
    const header = screen.getByRole("banner");

    expect(header).not.toHaveClass("site-header--scrolled");
    expect(header).not.toHaveClass("site-header--hidden");

    Object.defineProperty(window, "scrollY", { configurable: true, value: 24 });
    fireEvent.scroll(window);
    expect(header).toHaveClass("site-header--scrolled");
    expect(header).toHaveClass("site-header--hidden");

    Object.defineProperty(window, "scrollY", { configurable: true, value: 12 });
    fireEvent.scroll(window);
    expect(header).toHaveClass("site-header--scrolled");
    expect(header).not.toHaveClass("site-header--hidden");

    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    fireEvent.scroll(window);
    expect(header).not.toHaveClass("site-header--scrolled");
    expect(header).not.toHaveClass("site-header--hidden");
  });

  it("keeps the header visible while the mobile navigation menu is open", () => {
    render(<SiteHeader />);
    const header = screen.getByRole("banner");

    Object.defineProperty(window, "scrollY", { configurable: true, value: 24 });
    fireEvent.scroll(window);
    expect(header).toHaveClass("site-header--hidden");

    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    expect(header).toHaveClass("site-header--menu-open");
    expect(header).not.toHaveClass("site-header--hidden");

    Object.defineProperty(window, "scrollY", { configurable: true, value: 48 });
    fireEvent.scroll(window);
    expect(header).not.toHaveClass("site-header--hidden");
  });

  it("shows the persisted cart quantity", () => {
    localStorage.setItem(
      "rnr:commerce:v1:guest:cart",
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

  it("provides a cart icon and a four-line mobile menu without duplicating the market selector", () => {
    render(<SiteHeader />);

    expect(screen.getByRole("link", { name: "Cart, 0 items" })
      .querySelector(".site-header__cart-icon")).toBeInTheDocument();
    expect(document.querySelectorAll(".mobile-menu__icon-line")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    expect(screen.getByRole("navigation", { name: "Mobile navigation" }))
      .toHaveClass("mobile-menu__drawer");
    expect(within(screen.getByRole("navigation", { name: "Mobile navigation" }))
      .queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Country and currency" }))
      .toHaveValue("NZ");
  });

  it("keeps the mobile header logo visible from 340px upward with a readable market selector", () => {
    const stylesheet = readFileSync("src/app/globals.css", "utf8");
    const mobileRules = stylesheet.match(/@media \(max-width: 560px\) \{[\s\S]*?(?=\n@media|$)/)?.[0] ?? "";
    const narrowRules = stylesheet.match(/@media \(max-width: 374px\) \{[\s\S]*?(?=\n@media|$)/)?.[0] ?? "";
    const extremeRules = stylesheet.match(/@media \(max-width: 339px\) \{[\s\S]*?(?=\n@media|$)/)?.[0] ?? "";

    expect(mobileRules).toMatch(/\.site-header__brand \.brand-mark__logo\s*\{[^}]*width:\s*2\.625rem/);
    expect(mobileRules).toMatch(/\.site-header__market select\s*\{[^}]*height:\s*2\.75rem[^}]*font-size:\s*0\.72rem/);
    expect(narrowRules).toMatch(/\.site-header__market select\s*\{[^}]*width:\s*6\.375rem[^}]*padding-inline:\s*0\.5rem 1\.55rem/);
    expect(narrowRules).toMatch(/\.site-header__brand \.brand-mark__logo\s*\{[^}]*width:\s*2\.25rem/);
    expect(narrowRules).not.toMatch(/\.site-header__brand \.brand-mark__logo\s*\{[^}]*display:\s*none/);
    expect(extremeRules).toMatch(/\.site-header__brand \.brand-mark__logo\s*\{[^}]*display:\s*none/);
    expect(stylesheet).not.toMatch(/@media \(max-width: 420px\) \{[\s\S]*?\.site-header__brand \.brand-mark__logo\s*\{[^}]*display:\s*none/);
    expect(stylesheet).toMatch(/\.site-header__market select\s*\{[^}]*appearance:\s*none/);
    expect(mobileRules).toMatch(/\.mobile-menu\s*\{[^}]*margin-left:\s*-0\.25rem/);
    expect(mobileRules).toMatch(/\.mobile-menu > button,[\s\S]*?\.site-header__cart\s*\{[^}]*min-height:\s*48px/);
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

  it("moves focus into the mobile menu, contains Tab, and restores the trigger", () => {
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
    const mobileNavigation = screen.getByRole("navigation", { name: "Mobile navigation" });
    const firstLink = within(mobileNavigation).getByRole("link", { name: "Home" });
    const lastLink = within(mobileNavigation).getByRole("link", { name: "Start a Design" });

    expect(document.body.style.overflow).toBe("");
    expect(document.body.style.paddingRight).toBe("");
    expect(firstLink).toHaveFocus();

    lastLink.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(trigger).toHaveFocus();

    trigger.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(lastLink).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(menu).toHaveClass("mobile-menu--closing");
    act(() => vi.advanceTimersByTime(180));

    expect(screen.queryByRole("navigation", { name: "Mobile navigation" }))
      .not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
    expect(document.body.style.paddingRight).toBe("");
    expect(screen.getByRole("button", { name: "Open navigation menu" })).toHaveFocus();
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
      name: "Email customerservice@rnrgallery.com",
    });
    expect(email).toBeVisible();
    expect(email).toHaveAttribute("href", "mailto:customerservice@rnrgallery.com");
    expect(contact).toContainElement(email);
    expect(contact).not.toHaveTextContent("R&R Gallery Ltd");
    expect(contact).not.toHaveTextContent("11 Para Close");
    const businessLine = footer.querySelector<HTMLElement>(".site-footer__business-line");
    expect(businessLine).toHaveTextContent(
      "11 Para Close, Fairview Heights, Auckland 0632, New Zealand",
    );
    expect(businessLine).not.toHaveTextContent("R&R Gallery Ltd");
    expect(businessLine?.querySelector("strong")).toBeNull();
    expect(within(footer).getAllByRole("link", { name: /privacy/i }))
      .toHaveLength(1);
    expect(within(footer).getByRole("link", { name: "Designs by Product" }))
      .toHaveAttribute("href", "/#gallery");
    expect(within(footer).getByRole("link", { name: "Transformations" }))
      .toHaveAttribute("href", "/#transformation");
    expect(within(footer).getByRole("link", { name: "FAQ" }))
      .toHaveAttribute("href", "/help");
    expect(within(footer).getByRole("link", { name: "About" }))
      .toHaveAttribute("href", "/about");
    expect(within(footer).getByRole("link", { name: "Contact" }))
      .toHaveAttribute("href", "/contact");
    expect(within(footer).getByRole("link", { name: "Shipping & Delivery" }))
      .toHaveAttribute("href", "/shipping-delivery");
    expect(within(footer).getByRole("link", { name: "Cancellations & Refunds" }))
      .toHaveAttribute("href", "/returns-refunds");
  });

  it("keeps the footer navigation compact and only abbreviates email on narrow screens", () => {
    const stylesheet = readFileSync("src/app/globals.css", "utf8");
    const mobileRules = stylesheet.match(/@media \(max-width: 560px\) \{[\s\S]*?(?=\n@media|$)/)?.[0] ?? "";
    const narrowEmailRules = stylesheet.match(/@media \(max-width: 519px\) \{[\s\S]*?(?=\n@media|$)/)?.[0] ?? "";

    expect(stylesheet).toMatch(
      /\.site-footer__column\s*\{[^}]*font-size:\s*calc\(1rem - 2px\)[^}]*line-height:\s*1\.45/,
    );
    expect(stylesheet).toMatch(
      /\.site-footer__title\s*\{[^}]*margin-bottom:\s*0\.5rem[^}]*font-size:\s*calc\(0\.9rem - 2px\)/,
    );
    expect(stylesheet).toMatch(
      /\.site-footer li \+ li\s*\{[^}]*margin-top:\s*0\.25rem/,
    );
    expect(stylesheet).toMatch(
      /\.site-footer a\s*\{[^}]*min-height:\s*30px/,
    );
    expect(mobileRules).toMatch(
      /\.site-footer a,[\s\S]*?\.site-footer__cookie-trigger[\s\S]*?min-height:\s*36px/,
    );
    expect(mobileRules).not.toMatch(/\.site-footer__email-desktop\s*\{[^}]*display:\s*none/);
    expect(narrowEmailRules).toMatch(/\.site-footer__email-desktop\s*\{[^}]*display:\s*none/);
    expect(narrowEmailRules).toMatch(/\.site-footer__email-mobile\s*\{[^}]*display:\s*inline/);
  });

  it("shows only the approved payment brands in the requested order", () => {
    render(<SiteFooter />);
    const footer = screen.getByRole("contentinfo");
    const payments = within(footer).getByRole("region", {
      name: "Accepted payments",
    });

    expect(within(payments).getAllByRole("img").map((logo) =>
      logo.getAttribute("aria-label"),
    )).toEqual([
      "Visa",
      "Mastercard",
      "Afterpay",
      "Apple Pay",
      "Google Pay",
    ]);
    expect(payments.querySelectorAll("img")).toHaveLength(5);
    expect(Array.from(payments.querySelectorAll("img")).every((image) =>
      image.getAttribute("src")?.includes("/media/payments/footer-payment-methods.jpg"),
    )).toBe(true);
    expect(payments.querySelectorAll("svg")).toHaveLength(0);

    const intro = footer.querySelector(".site-footer__intro");
    expect(payments.parentElement).toHaveClass("site-footer__intro-stack");
    expect(payments.parentElement?.firstElementChild).toBe(intro);
    expect(footer.querySelector(".site-footer__grid")?.nextElementSibling)
      .toHaveClass("site-footer__legal");
  });

  it("places policies under Customer and links the footer brand to the page top", () => {
    render(<><SiteHeader /><SiteFooter /></>);
    const footer = screen.getByRole("contentinfo");
    const customerColumn = within(footer).getByText("Customer").parentElement!;
    const legalRow = footer.querySelector<HTMLElement>(".site-footer__legal")!;

    expect(document.querySelector("#top")).toHaveClass("page-top-anchor");
    expect(screen.getByRole("banner")).not.toHaveAttribute("id");
    expect(screen.getByRole("banner").querySelector(".site-header__brand"))
      .toHaveAccessibleName("R&R Gallery Custom Prints NZ home");
    const footerBrand = within(footer).getByRole("link", { name: "R&R Gallery Custom Prints NZ" });
    expect(footerBrand).toHaveAttribute("href", "#top");
    expect(decodeURIComponent(footerBrand.querySelector("img")?.getAttribute("src") ?? ""))
      .toContain("/media/brand/rr-gallery-logo-2026.webp");
    expect(within(footer).queryByRole("navigation", { name: "Footer policies" }))
      .not.toBeInTheDocument();
    expect(within(customerColumn).getByRole("link", { name: "Privacy" }))
      .toHaveAttribute("href", "/privacy");
    expect(within(customerColumn).getByRole("link", { name: "Terms" }))
      .toHaveAttribute("href", "/terms");
    expect(within(customerColumn).getByRole("link", { name: "Cancellations & Refunds" }))
      .toHaveAttribute("href", "/returns-refunds");
    expect(within(legalRow).queryByRole("navigation", {
      name: "Mobile footer policies",
    })).not.toBeInTheDocument();
    const copyright = within(legalRow).getByText("© 2026 R&R Gallery");
    const businessLine = legalRow.querySelector<HTMLElement>(".site-footer__business-line")!;
    expect(businessLine).toHaveClass("site-footer__business-line");
    expect(businessLine.nextElementSibling).toBe(copyright);
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
    expect(within(footer).getByRole("link", { name: "Email studio@example.test" })).toHaveAttribute("href", "mailto:studio@example.test");
    expect(within(footer).getByRole("link", { name: "+64 9 555 0100" })).toHaveAttribute("href", "tel:+6495550100");
  });
});
