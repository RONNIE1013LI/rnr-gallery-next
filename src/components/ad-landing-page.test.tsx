import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as analytics from "@/domain/analytics/client";
import { defaultProductRegistry, getRegistryProductBySlug } from "@/domain/catalogue/product-registry";
import { adLandingPages } from "@/domain/ads/landing-pages";
import { formatNzd } from "@/domain/money";
import { AdLandingPage } from "./ad-landing-page";

vi.mock("@/domain/analytics/client", () => ({
  emitAnalyticsEvent: vi.fn(() => true),
}));

describe("AdLandingPage", () => {
  it.each(Object.values(adLandingPages))("renders product-specific content for $path", (content) => {
    const product = getRegistryProductBySlug(defaultProductRegistry, content.productSlug)!;
    const priceInclGstCents = 54_321;
    const startingPrice = formatNzd(priceInclGstCents);
    const { container } = render(
      <AdLandingPage
        content={content}
        product={product}
        priceInclGstCents={priceInclGstCents}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: content.heading })).toBeVisible();
    expect(screen.getByText(content.sizeSummary)).toBeVisible();
    expect(screen.getByText(`From ${startingPrice} incl GST`)).toBeVisible();
    expect(screen.queryByText(/excl GST/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Start Customising" }))
      .toHaveLength(2);
    for (const link of screen.getAllByRole("link", { name: "Start Customising" })) {
      expect(link).toHaveAttribute("href", `/products/${content.productSlug}/configure`);
    }
    expect(screen.getByRole("link", { name: "Message on Messenger" }))
      .toHaveAttribute("href", "https://m.me/RandRgallery");
    expect(screen.getByRole("link", { name: "Message on Messenger" }))
      .toHaveAttribute("data-rnr-meta-contact-tracked", "true");
    expect(screen.getAllByText("Proof before printing").length).toBeGreaterThan(0);
    expect(screen.getByText("Two revisions included")).toBeVisible();

    const productData = JSON.parse(container.querySelector("#rnr-landing-product")?.textContent ?? "{}");
    expect(productData).toMatchObject({
      "@type": "Product",
      name: product.title,
      offers: { priceCurrency: "NZD", price: startingPrice.replace("NZ$", "") },
    });
    expect(JSON.parse(container.querySelector("#rnr-landing-breadcrumbs")?.textContent ?? "{}"))
      .toMatchObject({ "@type": "BreadcrumbList" });
  });

  it("keeps the three landing pages materially distinct", () => {
    const pages = Object.values(adLandingPages);
    expect(new Set(pages.map((page) => page.heading)).size).toBe(3);
    expect(new Set(pages.map((page) => page.description)).size).toBe(3);
    expect(new Set(pages.map((page) => page.included.join("|"))).size).toBe(3);
  });

  it("tracks a Messenger lead without adding customer data", () => {
    const content = Object.values(adLandingPages).find(
      (page) => page.path === "/custom-photo-canvas-nz",
    )!;
    const product = getRegistryProductBySlug(defaultProductRegistry, content.productSlug)!;
    render(<AdLandingPage content={content} product={product} priceInclGstCents={54_321} />);

    fireEvent.click(screen.getByRole("link", { name: "Message on Messenger" }));

    expect(analytics.emitAnalyticsEvent).toHaveBeenCalledWith({
      event: "messenger_click",
      location: content.path,
    });
    expect(analytics.emitAnalyticsEvent).toHaveBeenCalledWith({
      event: "generate_lead",
      method: "messenger",
    });
  });
});
