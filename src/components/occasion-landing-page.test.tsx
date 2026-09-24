import { renderToStaticMarkup } from "react-dom/server";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import { occasionLandingPages } from "@/domain/seo/occasion-landing-pages";
import type { PublicGalleryItem } from "@/server/gallery/public-gallery-service";
import { OccasionLandingPage } from "./occasion-landing-page";

vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
const artwork: PublicGalleryItem = {
  id: "a".repeat(64), productTypeSlug: "roll-up-banner", productSlug: "roll-up-banner", occasionSlug: "birthday",
  subOccasion: "1st-birthday", themeSlugs: [], altText: "Birthday portrait banner example", contentHash: "b".repeat(64), mimeType: "image/jpeg", width: 850, height: 2000,
  publicSlug: "1st-birthday-aaaaaaaa", displayTitle: "1st Birthday", seoTitle: "1st Birthday Roll-Up Banner Design",
  seoDescription: "First birthday roll-up banner design.", intro: "A first birthday roll-up banner design.",
  secondaryOccasions: [], palette: [], seoIndex: true, hiddenFromListings: false, canonicalDesignId: null, canonicalPublicSlug: null,
};

describe("occasion landing output", () => {
  it.each(Object.values(occasionLandingPages))("renders accessible commercial content at $path", (content) => {
    const { container } = render(<OccasionLandingPage content={content} registry={defaultProductRegistry} market="NZ" artwork={[artwork]} />);
    const guidance = container.querySelector('section[aria-labelledby="guidance-heading"]')!;
    expect(guidance).not.toBeNull();
    expect(guidance.querySelectorAll("ul > li")).toHaveLength(content.guidance.length);
    for (const { text } of content.guidance) expect(guidance).toHaveTextContent(text);
    const html = renderToStaticMarkup(<OccasionLandingPage content={content} registry={defaultProductRegistry} market="NZ" artwork={[artwork]} />);
    const serverDocument = new DOMParser().parseFromString(html, "text/html");
    for (const { text } of content.guidance) expect(serverDocument.body.textContent).toContain(text);
    for (const item of content.faq) expect(serverDocument.body.textContent).toContain(item.answer);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(content.heading);
    expect(container.querySelectorAll("details")).toHaveLength(5);
    expect(screen.getByRole("img", { name: artwork.altText })).toHaveAttribute("loading", "lazy");
    const design = screen.getByRole("link", { name: /View Design/ });
    expect(design.getAttribute("href")).toMatch(/^\/designs\/[^?]+$/);
    expect(screen.getAllByRole("link", { name: content.cta })).toHaveLength(1);
    for (const link of screen.getAllByRole("link", { name: content.cta })) expect(link).toHaveAttribute("href", `/products/${content.productSlugs[0]}`);
    for (const slug of content.productSlugs) expect(container.querySelector(`a[href="/products/${slug}"]`)).not.toBeNull();
    expect(container.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(1);
    expect(JSON.parse(container.querySelector("#rnr-occasion-breadcrumbs")!.textContent!)["@type"]).toBe("BreadcrumbList");
    expect(screen.queryByRole("button", { name: /3D|zoom|rotate/i })).not.toBeInTheDocument();
    expect(container.querySelector("[data-model-type=roll-up-banner]")).not.toBeNull();
  });
  it("keeps disabled products out of CTAs and retains a useful unavailable-artwork fallback", () => {
    const registry = structuredClone(defaultProductRegistry);
    registry.products.forEach((product) => { if (product.slug === "roll-up-banner") product.active = false; });
    const { container } = render(<OccasionLandingPage content={occasionLandingPages["birthday-banners"]} registry={registry} market="NZ" artwork={[]} artworkUnavailable />);
    expect(screen.getByText(/temporarily unavailable/)).toBeVisible();
    expect(container.querySelector('a[href^="/products/roll-up-banner"]')).toBeNull();
    expect(screen.getAllByRole("link", { name: "Start Your Birthday Banner" })[0]).toHaveAttribute("href", "/products/custom-themed-wall-banner");
  });
});
