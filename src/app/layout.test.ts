import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { metadata } from "./layout";

function cssFile(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function cssRule(source: string, selector: string) {
  const start = source.indexOf(selector);
  expect(start, `Missing CSS selector: ${selector}`).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf("}", start) + 1);
}

function productionSource(root: string): string {
  return readdirSync(join(process.cwd(), root), { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return [productionSource(path)];
      if (!/\.[cm]?[jt]sx?$/.test(entry.name) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) {
        return [];
      }
      return [readFileSync(join(process.cwd(), path), "utf8")];
    })
    .join("\n");
}

describe("root layout metadata", () => {
  it("uses the sole canonical production origin as metadataBase", () => {
    expect(metadata.metadataBase?.toString()).toBe("https://rnrgallery.com/");
  });

  it("uses the server-resolved request market before rendering site chrome", () => {
    const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");

    expect(layout).toContain("headers()");
    expect(layout).toContain('requestHeaders.get("x-rnr-resolved-market")');
    expect(layout).toContain("initialMarket={resolvedMarket}");
  });

  it("provides server-read consent before mounting the single controlled Google tag", () => {
    const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
    const controller = readFileSync(
      join(process.cwd(), "src/components/analytics-runtime-controller.tsx"),
      "utf8",
    );
    const source = productionSource("src");

    expect(layout).toContain("parseAdvertisingConsent(cookieStore.get(ADVERTISING_CONSENT_COOKIE)?.value)");
    expect(layout).toContain("<ConsentPreferences initialConsent={consent}>");
    expect(layout).toContain("<AnalyticsRuntimeController production={ga4Enabled} />");
    expect(controller).toContain("<GoogleAnalytics gaId={GA4_MEASUREMENT_ID}");
    expect(source.match(/<GoogleAnalytics\b/g)).toHaveLength(1);
    expect(source.match(/G-RE5Z5B58TJ/g)).toHaveLength(1);
    expect(source).not.toContain("GoogleTagManager");
    expect(layout).toContain("isGa4Production(process.env.VERCEL_ENV)");
  });

  it("does not document the replaced public analytics feature flag", () => {
    const example = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    expect(example).not.toContain("NEXT_PUBLIC_GOOGLE_ANALYTICS_ENABLED");
  });

  it("uses the current R&R Gallery mark for browser and Apple icons", () => {
    expect(metadata.icons).toEqual({
      icon: "/media/brand/rr-gallery-logo-2026.webp",
      apple: "/media/brand/rr-gallery-logo-2026.webp",
    });
  });

  it("uses the approved branded image and wording for default social shares", () => {
    const socialTitle = "R&R Gallery | Custom Canvas | Banners & Digital Oil Paintings NZ | Free Design Service";
    const socialImage = "/media/social/rr-gallery-social-share-2026.webp";

    expect(metadata.openGraph).toMatchObject({
      title: socialTitle,
      images: [{
        url: socialImage,
        width: 3840,
        height: 2160,
      }],
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      title: socialTitle,
      images: [socialImage],
    });
    expect(existsSync(join(process.cwd(), "public", socialImage))).toBe(true);
  });

  it("reserves the vertical scrollbar gutter so page changes do not shift the site frame", () => {
    const globals = cssFile("src/app/globals.css");

    expect(cssRule(globals, "html {")).toContain("scrollbar-gutter: stable;");
  });

  it("keeps the consent surface compact, reachable, and above the site chrome", () => {
    const globals = cssFile("src/app/globals.css");

    expect(cssRule(globals, ".consent-preferences {")).toContain("position: fixed;");
    expect(cssRule(globals, ".consent-preferences__content {")).toContain(
      "padding: 0.875rem 0.875rem 0.875rem 0.25rem;",
    );
    expect(cssRule(globals, ".consent-preferences h2 {")).toContain("font-size: 0.95rem;");
    expect(cssRule(globals, ".consent-preferences p {")).toContain("font-size: 0.75rem;");
    expect(cssRule(globals, ".consent-preferences button {")).toContain("font-size: 0.75rem;");
    expect(globals).toContain("--layer-sticky-cta: 30;");
    expect(globals).toContain("--layer-chat-launcher: 40;");
    expect(globals).toContain("--layer-chat-panel: 50;");
    expect(globals).toContain("--layer-consent: 60;");
    expect(cssRule(globals, ".consent-preferences {")).toContain("z-index: var(--layer-consent);");
    expect(globals).toMatch(/body:has\(\.consent-preferences\) \.customer-chat-root\s*\{[^}]*--customer-chat-bottom-offset:/);
    expect(globals).toMatch(/body:has\(\.consent-preferences\) \.customer-chat-root\s*\{[^}]*--customer-chat-bottom-offset:\s*17rem;/);
    expect(globals).toMatch(/body:has\(\.consent-preferences__options\) \.customer-chat-root\s*\{[^}]*--customer-chat-bottom-offset:\s*28rem;/);
    const trigger = cssRule(globals, ".site-footer__cookie-trigger {");
    expect(trigger).toContain("min-height: 44px;");
    expect(trigger).not.toContain("position: fixed;");
  });

  it("prevents iOS from rewriting server-rendered contact details before hydration", () => {
    expect(metadata.formatDetection).toEqual({
      address: false,
      email: false,
      telephone: false,
    });
  });

  it("uses one capsule radius for text action buttons across every site surface", () => {
    const globals = cssFile("src/app/globals.css");
    const storefront = cssFile("src/components/storefront.module.css");
    const admin = cssFile("src/components/admin/admin.module.css");
    const forms = cssFile("src/components/forms/forms.module.css");

    expect(globals).toContain("--radius-button: 999px;");
    for (const [source, selector] of [
      [storefront, ".primaryButton,\n.secondaryButton {"],
      [storefront, ".checkoutContinuation .socialAuthButton,"],
      [storefront, ".socialAuthButton {\n  width: 100%;"],
      [admin, ".primaryAdminButton {"],
      [admin, ".filterActions button,"],
      [admin, ".secondaryAdminButton,\n.removeItemButton {"],
      [forms, ".signOutControl button,"],
      [forms, ".formsErrorState a,"],
      [forms, ".filterButton,"],
      [forms, ".addFilterButton,"],
    ] as const) {
      expect(cssRule(source, selector)).toContain("border-radius: var(--radius-button);");
    }
  });

  it("keeps public product and design starting prices at the approved size without heavy type", () => {
    const style = document.createElement("style");
    style.textContent = cssFile("src/components/storefront.module.css");
    const price = document.createElement("p");
    price.className = "productDetailPrice";
    document.head.append(style);
    document.body.append(price);

    try {
      const computed = getComputedStyle(price);
      expect(computed.fontSize).toBe("17.28px");
      expect(computed.fontWeight).toBe("500");
    } finally {
      price.remove();
      style.remove();
    }
  });

  it("preserves the approved morning mobile-menu trigger and close treatment", () => {
    const globals = cssFile("src/app/globals.css");
    const trigger = cssRule(globals, ".mobile-menu > button {");
    const openTrigger = cssRule(globals, ".mobile-menu--open > button {");

    expect(trigger).toContain("width: 52px;");
    expect(trigger).toContain("height: 56px;");
    expect(trigger).toContain("background: transparent;");
    expect(trigger).toContain("border: 1px solid transparent;");
    expect(openTrigger).toContain("color: var(--text-on-dark);");
    expect(openTrigger).toContain("border-color: transparent;");

    const openHeader = cssRule(globals, ".site-header--menu-open {");
    expect(openHeader).toContain("background: var(--brand-green);");
    expect(openHeader).toContain("-webkit-backdrop-filter: none;");
    expect(openHeader).toContain("backdrop-filter: none;");

    const backdrop = cssRule(globals, ".mobile-menu > .mobile-menu__backdrop {");
    expect(backdrop).toContain("position: fixed;");
    expect(backdrop).toContain("width: auto;");
    expect(backdrop).toContain("height: calc(100dvh - 5.25rem);");
    expect(backdrop).toContain("-webkit-backdrop-filter: saturate(80%) blur(8px);");
    expect(backdrop).toContain("backdrop-filter: saturate(80%) blur(8px);");
  });

  it("uses the approved shared Header and Footer brand-frame tokens", () => {
    const globals = cssFile("src/app/globals.css");

    expect(globals).toContain("--brand-green: #142b25;");
    expect(globals).toContain("--brand-ivory: #faf5ef;");
    expect(globals).toContain("--brand-gold: #b89a62;");
    expect(globals).toContain("--brand-ivory-hover: #eee7de;");
    expect(globals).toContain("--text-on-dark: #f5f1eb;");
    expect(globals).toContain("--text-on-dark-muted: #cfc8be;");
    expect(cssRule(globals, ".site-header {")).toContain("background: var(--brand-green);");
    expect(cssRule(globals, ".site-footer {")).toContain("background: var(--brand-green);");
  });

  it("shows the supplied footer payment artwork at the approved responsive sizes with a four-pixel source crop", () => {
    const globals = cssFile("src/app/globals.css");
    const logo = cssRule(globals, ".site-footer__payment-logo {");
    const mark = cssRule(globals, ".site-footer__payment-mark {");
    const sprite = cssRule(globals, ".site-footer__payment-sprite {");

    expect(logo).toContain("width: 2.5rem;");
    expect(mark).toContain("aspect-ratio: 147 / 92;");
    expect(sprite).toContain("top: -4.3478%;");
    expect(sprite).toContain("left: -2.7211%;");
    expect(sprite).toContain("width: 796.5986%;");
    expect(sprite).toContain("height: 108.6957%;");
    expect(globals).toContain("width: 1.875rem;\n    min-width: 1.875rem;");
  });

  it("keeps the footer address on one line at one shared desktop and mobile font size", () => {
    const globals = cssFile("src/app/globals.css");
    const businessRules = globals.match(/\.site-footer__business-line\s*\{/g) ?? [];

    expect(businessRules).toHaveLength(1);
    const businessLine = cssRule(globals, ".site-footer__business-line {");
    expect(businessLine).toContain("font-size: 0.8125rem;");
    expect(businessLine).toContain("white-space: nowrap;");
    expect(businessLine).toContain("width: calc(100% + 2.5rem);");
  });

  it("stacks admin page-header actions at the tablet breakpoint", () => {
    const admin = cssFile("src/components/admin/admin.module.css");
    const mobileStart = admin.lastIndexOf("@media (max-width: 560px) {");
    const tabletStart = admin.lastIndexOf("@media (max-width: 820px) {", mobileStart);

    expect(tabletStart).toBeGreaterThanOrEqual(0);
    expect(mobileStart).toBeGreaterThan(tabletStart);

    const tablet = admin.slice(tabletStart, mobileStart);
    expect(tablet).toContain(".productionPageHeader {\n    display: grid;");
    expect(tablet).toContain(".productionPageHeader .headerActions {\n    justify-content: flex-start;");
  });
});
