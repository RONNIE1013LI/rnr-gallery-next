import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import type { PublicGalleryItem } from "@/server/gallery/public-gallery-service";
import { selectHomepageGalleryItems } from "./homepage-gallery";
import { HomepageV3 } from "./homepage-v3";
import { homepageV3ImageSlots } from "./homepage-v3-images";

function galleryItem(
  id: string,
  overrides: Partial<PublicGalleryItem> = {},
): PublicGalleryItem {
  return {
    id,
    productTypeSlug: "canvas",
    occasionSlug: "personalised-artwork",
    subOccasion: null,
    themeSlugs: [],
    altText: `Gallery artwork ${id}`,
    productSlug: "digital-oil-painting-canvas",
    contentHash: `hash-${id}`,
    mimeType: "image/jpeg",
    width: 1200,
    height: 900,
    ...overrides,
  };
}

describe("HomepageV3", () => {
  it("publishes parseable LocalBusiness and WebSite structured data", () => {
    const { container } = render(<HomepageV3 registry={defaultProductRegistry} />);
    const localBusiness = container.querySelector("#rnr-local-business");
    const website = container.querySelector("#rnr-website");

    expect(JSON.parse(localBusiness?.textContent ?? "{}")).toMatchObject({
      "@type": "LocalBusiness",
      name: "R&R Gallery",
    });
    expect(JSON.parse(website?.textContent ?? "{}")).toMatchObject({
      "@type": "WebSite",
      name: "R&R Gallery",
      url: "https://rrgallery.co.nz/",
    });
  });

  it("uses controlled FAQ buttons instead of hydration-sensitive native details", () => {
    render(<HomepageV3 registry={defaultProductRegistry} />);
    const question = screen.getByRole("button", {
      name: "My photos are blurry. Can you still use them?",
    });
    expect(question).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(question);
    expect(question).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Yes, please send us the original photos/)).toBeVisible();
  });
  it("presents the hero as one finished artwork, one real moment and one printed canvas", () => {
    render(<HomepageV3 registry={defaultProductRegistry} />);

    const heroHeading = screen.getByRole("heading", {
      level: 1,
      name: "From the photos you have to the piece you imagined.",
    });
    const heroSection = heroHeading.closest("section");

    expect(heroSection).not.toBeNull();
    expect(heroSection?.querySelectorAll("img")).toHaveLength(3);
    expect(screen.getByRole("img", {
      name: "Finished custom family artwork created by R&R Gallery",
    })).toBeInTheDocument();
    expect(screen.getByRole("img", {
      name: "Customer standing beside her personalised family canvas",
    })).toBeInTheDocument();
    const printedCanvasImage = screen.getByRole("img", {
      name: "Personalised family artwork printed and displayed as a canvas",
    });
    expect(printedCanvasImage).toBeInTheDocument();
    expect(heroSection).toHaveTextContent("FINISHED ARTWORK");
    expect(heroSection).toHaveTextContent("REAL MOMENT");
    expect(heroSection).toHaveTextContent("PRINTED CANVAS");
    expect(printedCanvasImage.parentElement).toHaveTextContent("PRINTED CANVAS");
    expect(screen.queryByText("PRINTED CANVAS", {
      selector: "figcaption",
    })).not.toBeInTheDocument();
    expect(heroSection).not.toHaveTextContent("ORIGINAL PHOTO");
    expect(heroSection).not.toHaveTextContent("Created from 3 family photographs");

    const stylesheet = readFileSync(
      "src/components/homepage-v3.module.css",
      "utf8",
    );
    expect(stylesheet).toMatch(
      /@media \(max-width:\s*760px\)[\s\S]*?\.realMomentCard \.mediaLabel\s*\{[^}]*white-space:\s*nowrap/,
    );
    expect(stylesheet).toMatch(
      /\.realMomentCard\s*\{[^}]*z-index:\s*5/,
    );
  });

  it("prioritises only the actual homepage LCP image", () => {
    const { container } = render(<HomepageV3 registry={defaultProductRegistry} />);

    const lcpImage = screen.getByRole("img", {
      name: "Finished custom family artwork created by R&R Gallery",
    });
    expect(lcpImage).toHaveAttribute("fetchpriority", "high");
    expect(lcpImage).not.toHaveAttribute("loading", "lazy");

    const otherImages = Array.from(container.querySelectorAll("img"))
      .filter((image) => image !== lcpImage);
    expect(otherImages.length).toBeGreaterThan(0);
    for (const image of otherImages) {
      expect(image).toHaveAttribute("loading", "lazy");
      expect(image).not.toHaveAttribute("fetchpriority", "high");
    }
  });

  it("merges product and helper paths into one discovery section", () => {
    const { container } = render(<HomepageV3 registry={defaultProductRegistry} />);

    const discovery = container.querySelector<HTMLElement>("#begin");
    const productsAnchor = container.querySelector<HTMLElement>("#products");

    expect(discovery).not.toBeNull();
    expect(productsAnchor).not.toBeNull();
    expect(discovery).toContainElement(productsAnchor);
    expect(screen.getByRole("heading", {
      level: 2,
      name: "Find the right way to begin.",
    })).toBeInTheDocument();
    expect(discovery).toHaveTextContent("Custom Canvas");
    expect(discovery).toHaveTextContent("Wall Banner");
    expect(discovery).toHaveTextContent("Roll-up Banner");
    expect(discovery).toHaveTextContent("Grave Cover");
    expect(discovery).toHaveTextContent("birthday");
    expect(discovery).toHaveTextContent("memorial");
    expect(discovery).toHaveTextContent("family");
    expect(screen.getByRole("link", { name: "View all products" }))
      .toHaveAttribute("href", "/shop");
    expect(screen.getByRole("link", { name: "Browse by occasion" }))
      .toHaveAttribute("href", "/design-gallery?filters=1#browse-by-occasion");
    expect(screen.getByRole("link", { name: "Start with your photos" }))
      .toHaveAttribute("href", "/shop");
    expect(screen.getByRole("link", { name: "Get Design Help" }))
      .toHaveAttribute("href", "https://m.me/RandRgallery");
    expect(screen.queryByRole("heading", { name: "How would you like to begin?" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Choose the form that fits the moment." }))
      .not.toBeInTheDocument();
    expect(screen.queryByText("I know what I need")).not.toBeInTheDocument();
    expect(screen.queryByText("NOT SURE WHICH FORMAT?")).not.toBeInTheDocument();
  });

  it("places the real-work gallery immediately after the reassurance strip", () => {
    const { container } = render(<HomepageV3 registry={defaultProductRegistry} />);
    const sections = Array.from(container.querySelectorAll("main > section"));
    const reassuranceIndex = sections.findIndex(
      (section) => section.getAttribute("aria-label") === "Service reassurance",
    );
    const galleryIndex = sections.findIndex((section) => section.id === "gallery");
    const beginIndex = sections.findIndex((section) => section.id === "begin");
    const transformationIndex = sections.findIndex(
      (section) => section.id === "transformation",
    );

    expect(reassuranceIndex).toBeGreaterThanOrEqual(0);
    expect(galleryIndex).toBe(reassuranceIndex + 1);
    expect(beginIndex).toBe(galleryIndex + 1);
    expect(transformationIndex).toBe(beginIndex + 1);
    expect(sections.filter((section) => section.id === "products")).toHaveLength(0);
  });

  it("keeps reordered neighbouring sections visually distinct", () => {
    const { container } = render(<HomepageV3 registry={defaultProductRegistry} />);
    const gallery = container.querySelector("#gallery");
    const begin = container.querySelector("#begin");

    expect(gallery?.className).toContain("sectionWarm");
    expect(begin?.className).toContain("sectionPaper");
  });

  it("places the hero artwork before the actions on mobile only", () => {
    const stylesheet = readFileSync(
      "src/components/homepage-v3.module.css",
      "utf8",
    );
    const mobileStyles = stylesheet.slice(
      stylesheet.indexOf("@media (max-width: 760px)"),
    );

    expect(mobileStyles).toContain(
      ".heroGrid { min-height: auto; display: flex; flex-direction: column; align-items: stretch; gap: 0; }",
    );
    expect(mobileStyles).toContain(".heroCopy { display: contents; }");
    expect(mobileStyles).toContain(".heroArt { order: 4;");
    expect(mobileStyles).toContain(".heroActions { order: 5;");
    expect(mobileStyles).toContain(".microcopy { order: 6;");
  });

  it("stacks the supporting discovery paths on mobile", () => {
    const stylesheet = readFileSync(
      "src/components/homepage-v3.module.css",
      "utf8",
    );
    const mobileStyles = stylesheet.slice(
      stylesheet.indexOf("@media (max-width: 760px)"),
    );

    expect(mobileStyles).toMatch(
      /\.discoverySupport\s*\{[^}]*grid-template-columns:\s*1fr/,
    );
  });

  it("frames the supporting discovery paths as one translucent panel", () => {
    const stylesheet = readFileSync(
      "src/components/homepage-v3.module.css",
      "utf8",
    );

    expect(stylesheet).toMatch(
      /\.discoverySupport\s*\{[^}]*border:\s*1px solid var\(--v3-line\)[^}]*border-radius:\s*var\(--v3-radius-panel\)[^}]*background:\s*rgb\(255 253 249 \/ 68%\)/,
    );
  });

  it("uses full reassurance copy on desktop and concise copy on mobile", () => {
    render(<HomepageV3 registry={defaultProductRegistry} />);

    expect(screen.getAllByText(
      "Every artwork is reviewed and refined by our team before printing.",
    )).toHaveLength(2);
    expect(screen.getByText(
      "Review the design and request up to two free revisions.",
    )).toBeInTheDocument();
    expect(screen.getByText(
      "Delivery options are available for New Zealand and Australia.",
    )).toBeInTheDocument();
    expect(screen.getByText(
      "Help choosing photos, wording and format.",
    )).toBeInTheDocument();

    expect(screen.getByText(
      "Reviewed and refined by our team before printing.",
    )).toBeInTheDocument();
    expect(screen.getByText(
      "Review your proof with two free revisions.",
    )).toBeInTheDocument();
    expect(screen.getByText(
      "Delivery across New Zealand and Australia.",
    )).toBeInTheDocument();
    expect(screen.getByText(
      "Help with photos, wording and format.",
    )).toBeInTheDocument();

    const stylesheet = readFileSync(
      "src/components/homepage-v3.module.css",
      "utf8",
    );
    const mobileStyles = stylesheet.slice(
      stylesheet.indexOf("@media (max-width: 760px)"),
    );

    expect(mobileStyles).toContain(
      "grid-template-columns: minmax(0, 58%) minmax(0, 42%);",
    );
    expect(mobileStyles).toContain(
      ".trustItem { padding: 0 0.75rem; justify-content: flex-start; }",
    );
    expect(stylesheet).toContain(".trustCopyMobile { display: none; }");
    expect(mobileStyles).toContain(".trustCopyDesktop { display: none; }");
    expect(mobileStyles).toContain(".trustCopyMobile { display: inline; }");
  });

  it("centers horizontal product descriptions on mobile to match vertical products", () => {
    const stylesheet = readFileSync(
      "src/components/homepage-v3.module.css",
      "utf8",
    );
    const mobileStyles = stylesheet.slice(
      stylesheet.indexOf("@media (max-width: 760px)"),
    );

    expect(mobileStyles).toContain(
      ".productFeature .productCopy { text-align: center; }",
    );
    expect(mobileStyles).toContain(
      ".productFeature .productCopy p { margin-inline: auto; }",
    );
    expect(mobileStyles).toContain(
      ".productFeature .textLink { justify-content: center; }",
    );
  });

  it("shows the real proof conversation in an interactive scroll frame", () => {
    render(<HomepageV3 registry={defaultProductRegistry} />);

    const proofConversation = screen.getByRole("region", {
      name: "Customer design proof and approval conversation",
    });

    expect(proofConversation).toHaveAttribute("tabindex", "0");
    expect(proofConversation).toHaveAttribute("data-proof-scroll", "auto-manual");
    expect(screen.getByRole("img", {
      name: "Memorial artwork proof followed by the customer's approval to print",
    })).toBeInTheDocument();
    expect(screen.queryByText("Draft 01")).not.toBeInTheDocument();

    Object.defineProperty(proofConversation, "scrollHeight", { value: 800 });
    fireEvent.keyDown(proofConversation, { key: "End" });
    expect(proofConversation.scrollTop).toBe(800);
    fireEvent.keyDown(proofConversation, { key: "Home" });
    expect(proofConversation.scrollTop).toBe(0);
  });

  it("uses the established green, gold and tiered CTA styling", () => {
    const stylesheet = readFileSync(
      "src/components/homepage-v3.module.css",
      "utf8",
    );

    expect(stylesheet).toContain("--v3-forest: #12372f;");
    expect(stylesheet).toContain("--v3-forest-deep: #0d2b25;");
    expect(stylesheet).toContain("--v3-gold: #76511d;");
    expect(stylesheet).toContain("--v3-pale-gold: #dbc17c;");
    expect(stylesheet).toContain(
      ".buttonPrimary { color: white; background: var(--v3-forest); }",
    );
    expect(stylesheet).toContain(
      ".buttonLight { color: var(--v3-forest); background: var(--v3-paper); }",
    );
    expect(stylesheet).toContain(
      ".buttonOutline { color: var(--v3-forest); border-color: var(--v3-forest); background: transparent; }",
    );
  });

  it("reserves section eyebrows for real brand emphasis moments", () => {
    render(<HomepageV3 registry={defaultProductRegistry} />);

    expect(screen.getByText("CUSTOM STORY & ARTWORK STUDIO")).toBeInTheDocument();
    expect(screen.getByText("SIGNATURE TRANSFORMATION")).toBeInTheDocument();
    expect(screen.getByText("THE R&R GALLERY DIFFERENCE")).toBeInTheDocument();
    expect(screen.getByText("A PLACE TO START")).toBeInTheDocument();

    expect(screen.queryByText("FOUR PRODUCTS, REAL WORK")).not.toBeInTheDocument();
    expect(screen.queryByText("CHOOSE A PHYSICAL FORMAT")).not.toBeInTheDocument();
    expect(screen.queryByText("A STORY THAT MEANT MORE")).not.toBeInTheDocument();
    expect(screen.queryByText("BEFORE YOU BEGIN")).not.toBeInTheDocument();

    expect(screen.getByText("BROWSE BY OCCASION")).toBeInTheDocument();
    expect(screen.getByText("START WITH YOUR PHOTOS")).toBeInTheDocument();
    expect(screen.getByText("DESIGN HELP")).toBeInTheDocument();
  });

  it("defines one homepage rhythm, heading and radius hierarchy", () => {
    const stylesheet = readFileSync(
      "src/components/homepage-v3.module.css",
      "utf8",
    );

    expect(stylesheet).toContain("--v3-content-width: 80.5rem;");
    expect(stylesheet).toContain("--v3-section-standard: 6rem;");
    expect(stylesheet).toContain("--v3-section-emphasis: 7rem;");
    expect(stylesheet).toContain("--v3-section-compact: 4rem;");
    expect(stylesheet).toContain("--v3-radius-image: 1rem;");
    expect(stylesheet).toContain("--v3-radius-thumbnail: 0.75rem;");
    expect(stylesheet).toContain("--v3-radius-panel: 1rem;");
    expect(stylesheet).toMatch(
      /\.shell\s*\{[^}]*width:\s*min\(var\(--v3-content-width\),\s*calc\(100%\s*-\s*4rem\)\)/,
    );
    expect(stylesheet).toMatch(
      /\.gallerySection\s*\{[^}]*padding:\s*var\(--v3-section-standard\)\s*0/,
    );
    expect(stylesheet).toMatch(
      /\.transformationSection\s*\{[^}]*padding:\s*var\(--v3-section-emphasis\)\s*0/,
    );
  });

  it("gives the gallery mosaic comfortable spacing and the default card radius", () => {
    const stylesheet = readFileSync(
      "src/components/homepage-v3.module.css",
      "utf8",
    );

    expect(stylesheet).toMatch(
      /\.galleryMosaic\s*\{[^}]*width:\s*100%[^}]*margin-inline:\s*auto[^}]*gap:\s*clamp\(1rem,\s*1\.25vw,\s*1\.5rem\)/,
    );
    expect(stylesheet).toMatch(
      /\.galleryLink\s*\{[^}]*margin-top:\s*2\.75rem;[^}]*margin-left:\s*0/,
    );
    expect(stylesheet).toMatch(
      /\.galleryLeftColumn\s*\{[^}]*gap:\s*clamp\(1rem,\s*1\.25vw,\s*1\.5rem\)/,
    );
    expect(stylesheet).toMatch(
      /\.galleryCanvasRow\s*\{[^}]*gap:\s*clamp\(1rem,\s*1\.25vw,\s*1\.5rem\)/,
    );
    expect(stylesheet).toMatch(
      /\.galleryRealMedia\s*\{[^}]*border-radius:\s*var\(--radius-card\)/,
    );
  });

  it("keeps the product backdrop pinned until the next section covers it", () => {
    const stylesheet = readFileSync(
      "src/components/homepage-v3.module.css",
      "utf8",
    );

    expect(stylesheet).toMatch(
      /\.productsBackdropImage\s*\{[^}]*background-size:\s*cover/,
    );
    expect(stylesheet).toContain(
      'url("/media/home/homepage-products-ink-sailboat.webp")',
    );
    expect(stylesheet).not.toContain("homepage-products-ink-landscape.webp");
    expect(stylesheet).toMatch(
      /\.productsBackdrop\s*\{[^}]*width:\s*min\(100%,\s*90rem\)[^}]*margin-inline:\s*auto/,
    );
    expect(stylesheet).toMatch(
      /\.productsSection\s*\{[^}]*overflow:\s*clip/,
    );
    expect(stylesheet).toMatch(
      /\.productsBackdrop\s*\{[^}]*bottom:\s*calc\(var\(--products-backdrop-top\)\s*-\s*100svh\);/,
    );
    const tabletStyles = stylesheet.slice(
      stylesheet.indexOf("@media (max-width: 900px)"),
      stylesheet.indexOf("@media (max-width: 760px)"),
    );
    expect(tabletStyles).toMatch(
      /\.productsSection\s*\{[^}]*--products-backdrop-top:\s*4\.75rem/,
    );
    expect(stylesheet).toMatch(
      /@media \(max-width:\s*760px\)[\s\S]*?\.productsBackdropImage\s*\{[^}]*background-size:\s*cover,\s*contain/,
    );
    expect(stylesheet).toMatch(
      /\.gallerySection\s*\{[^}]*position:\s*relative[^}]*z-index:\s*1[^}]*background:\s*var\(--v3-warm\)/,
    );
    expect(stylesheet).toMatch(
      /\.storySection\s*\{[^}]*position:\s*relative[^}]*z-index:\s*1/,
    );
  });

  it("lets the proof steps set the desktop panel height while the conversation fills the spare space", () => {
    const component = readFileSync(
      "src/components/homepage-v3.tsx",
      "utf8",
    );
    const stylesheet = readFileSync(
      "src/components/homepage-v3.module.css",
      "utf8",
    );

    expect(component).toContain("className={styles.proofVisualColumn}");
    expect(stylesheet).toMatch(
      /\.proofVisualColumn\s*\{[^}]*min-height:\s*0[^}]*height:\s*100%[^}]*display:\s*grid[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto[^}]*gap:\s*1\.5rem[^}]*contain:\s*size/,
    );
    expect(stylesheet).toMatch(
      /\.proofConversation\s*\{[^}]*height:\s*100%[^}]*min-height:\s*0[^}]*aspect-ratio:\s*auto/,
    );
    expect(stylesheet).toMatch(/\.approvedBox\s*\{[^}]*margin-top:\s*0/);
    expect(stylesheet).toMatch(
      /@media \(max-width:\s*760px\)[\s\S]*?\.proofVisualColumn\s*\{[^}]*height:\s*auto[^}]*display:\s*block[^}]*contain:\s*none[^}]*\}[\s\S]*?\.proofConversation\s*\{[^}]*height:\s*auto[^}]*aspect-ratio:\s*4\s*\/\s*3[^}]*\}[\s\S]*?\.approvedBox\s*\{[^}]*margin-top:\s*1\.5rem/,
    );
  });

  it("centres the finished transformation result at the compact desktop breakpoint", () => {
    const stylesheet = readFileSync(
      "src/components/homepage-v3.module.css",
      "utf8",
    );

    expect(stylesheet).toMatch(
      /@media \(max-width:\s*1080px\)[\s\S]*?\.transformationResult\s*\{[^}]*justify-self:\s*center/,
    );
  });

  it("renders the approved V3 story and verified service language", () => {
    const { container } = render(<HomepageV3 registry={defaultProductRegistry} />);

    expect(container.querySelector("main")).not.toHaveAttribute("data-homepage-palette");
    expect(screen.getByRole("heading", {
      level: 1,
      name: "From the photos you have to the piece you imagined.",
    })).toBeInTheDocument();
    expect(screen.getByText("DESIGNER-LED. APPROVED BY YOU.")).toBeInTheDocument();
    expect(screen.queryByText("DESIGNED BY REAL PEOPLE")).not.toBeInTheDocument();
    expect(screen.getAllByText(
      "Every artwork is reviewed and refined by our team before printing.",
    )).toHaveLength(2);
    expect(screen.getAllByText(/Two free design revisions are included/)).toHaveLength(2);
    expect(screen.getByText(/Production normally takes 5 business days/)).toBeInTheDocument();
    expect(screen.getByText(
      "Yes, please send us the original photos 😊 We’ll check the quality and enhance them where possible. Very blurry or low-resolution photos may affect the final result, so if any photo isn’t clear enough, we’ll let you know and ask for a better one.",
    )).toBeInTheDocument();
  });

  it("offers direct Messenger help alongside the FAQ", () => {
    render(<HomepageV3 registry={defaultProductRegistry} />);

    expect(screen.getByText(
      "Have more questions? Find R&R Gallery on Facebook or click below to message us. Our team will reply as soon as possible.",
    )).toBeInTheDocument();
    const messengerLink = screen.getByRole("link", { name: "Message R&R" });
    expect(messengerLink).toHaveAttribute("href", "https://m.me/RandRgallery");
    expect(messengerLink.querySelector("svg")).toBeInTheDocument();

    const stylesheet = readFileSync(
      "src/components/homepage-v3.module.css",
      "utf8",
    );
    expect(stylesheet).toMatch(
      /\.faqContact\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/,
    );
    expect(stylesheet).toMatch(
      /\.faqContactButton\s*\{[^}]*align-self:\s*center/,
    );
  });

  it("maps every call to action to a real storefront destination", () => {
    const { container } = render(<HomepageV3 registry={defaultProductRegistry} />);

    expect(screen.getAllByRole("link", { name: "Start With Your Photos" })[0])
      .toHaveAttribute("href", "/shop");
    expect(screen.getByRole("link", { name: "Shop Custom Canvas" }))
      .toHaveAttribute("href", "/canvas");
    expect(screen.getByRole("link", { name: "Shop Wall Banners" }))
      .toHaveAttribute("href", "/products/custom-themed-wall-banner/configure");
    expect(screen.getByRole("link", { name: "Shop Roll-up Banners" }))
      .toHaveAttribute("href", "/products/roll-up-banner/configure");
    expect(screen.getByText(
      "A custom-designed 85 × 200 cm printed roll-up banner supplied with its stand, carry bag, pegs and box.",
    )).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Shop Grave Covers" }))
      .toHaveAttribute("href", "/products/grave-cover/configure");
    expect(screen.getByRole("link", { name: "View the full gallery" }))
      .toHaveAttribute("href", "/design-gallery");
    expect(screen.getByRole("link", { name: "Get Design Help" }))
      .toHaveAttribute("href", "https://m.me/RandRgallery");
    expect(container.querySelector('a[href="#"]')).not.toBeInTheDocument();
  });

  it("keeps Australian homepage shopping links on direct AUD configuration routes", () => {
    render(<HomepageV3 registry={defaultProductRegistry} market="AU" />);

    expect(screen.getAllByRole("link", { name: "Start With Your Photos" })[0])
      .toHaveAttribute("href", "/au/shop");
    expect(screen.getByRole("link", { name: "Shop Custom Canvas" }))
      .toHaveAttribute("href", "/au/canvas");
    expect(screen.getByRole("link", { name: "Shop Wall Banners" }))
      .toHaveAttribute("href", "/au/products/custom-themed-wall-banner/configure");
    expect(screen.getByRole("link", { name: "Shop Roll-up Banners" }))
      .toHaveAttribute("href", "/au/products/roll-up-banner/configure");
    expect(screen.getByRole("link", { name: "Shop Grave Covers" }))
      .toHaveAttribute("href", "/au/products/grave-cover/configure");
    expect(screen.getByRole("link", { name: "View all products" }))
      .toHaveAttribute("href", "/au/shop");
  });

  it("preserves the approved physical product proportions", () => {
    const { container } = render(<HomepageV3 registry={defaultProductRegistry} />);

    expect(container.querySelector('[data-product-ratio="canvas-5-4"]')).toBeInTheDocument();
    expect(container.querySelector('[data-product-ratio="wall-banner-5-4"]')).toBeInTheDocument();
    expect(container.querySelector('[data-product-ratio="roll-up-4-5"]')).toBeInTheDocument();
    expect(container.querySelector('[data-product-ratio="grave-cover-4-5"]')).toBeInTheDocument();
    const productsSection = container.querySelector("#begin");
    expect(productsSection).not.toHaveTextContent("5:4");
    expect(productsSection).not.toHaveTextContent("4:5");
    expect(productsSection).not.toHaveTextContent("CUSTOM CANVAS");
    expect(productsSection).not.toHaveTextContent("WALL BANNER");
    expect(productsSection).not.toHaveTextContent("ROLL-UP BANNER");
    expect(productsSection).not.toHaveTextContent("GRAVE COVER");

    const stylesheet = readFileSync(
      "src/components/homepage-v3.module.css",
      "utf8",
    );
    expect(stylesheet).toMatch(
      /\.productVertical\s*\{[^}]*grid-template-columns:\s*23\.75rem\s+minmax\(0,\s*1fr\)/,
    );
    expect(stylesheet).toMatch(
      /@media \(max-width:\s*760px\)[\s\S]*?\.productVertical \.productMedia\s*\{[^}]*width:\s*min\(100%,\s*23\.75rem\)/,
    );
  });

  it("uses the approved three source photos and one 5:4 finished family artwork", () => {
    const { container } = render(<HomepageV3 registry={defaultProductRegistry} />);
    const transformation = container.querySelector("#transformation");
    const transformationEyebrow = screen.getByText("SIGNATURE TRANSFORMATION");
    const transformationHeading = transformation?.querySelector("h2");

    expect(homepageV3ImageSlots.signatureOriginalPhotos.map(({ src }) => src))
      .toEqual([
        "/media/home/homepage-signature-photo-01.webp",
        "/media/home/homepage-signature-photo-02.webp",
        "/media/home/homepage-signature-photo-03.webp",
    ]);
    expect(homepageV3ImageSlots.signatureFinishedArtwork.src)
      .toBe("/media/home/homepage-signature-family-artwork-v2.webp");
    expect(transformation).not.toHaveTextContent("PRINTED CANVAS");
    expect(transformation).not.toHaveTextContent("4:3");
    expect(transformationEyebrow.parentElement).toBe(transformation?.firstElementChild);
    expect(transformationEyebrow.nextElementSibling).toContainElement(
      transformationHeading ?? null,
    );
    expect(transformationEyebrow.nextElementSibling?.children).toHaveLength(3);

    const stylesheet = readFileSync(
      "src/components/homepage-v3.module.css",
      "utf8",
    );
    expect(stylesheet).toMatch(
      /\.transformationGrid\s*\{[^}]*align-items:\s*center/,
    );
    expect(stylesheet).toMatch(
      /@media \(min-width:\s*1081px\)[\s\S]*?\.workList\s*\{[^}]*margin-top:\s*0/,
    );
    expect(stylesheet).not.toMatch(
      /@media \(min-width:\s*1081px\)[\s\S]*?\.transformationResult\s*\{[^}]*(?:transform:\s*translateY|align-self:\s*start)/,
    );
    expect(stylesheet).toMatch(
      /\.rawOne \.mediaLabel,\s*\.rawThree \.mediaLabel\s*\{[^}]*bottom:\s*0\.75rem[^}]*left:\s*0\.75rem/,
    );
    expect(stylesheet).toMatch(
      /\.rawTwo \.mediaLabel\s*\{[^}]*right:\s*0\.75rem[^}]*bottom:\s*0\.75rem/,
    );
    expect(stylesheet).toMatch(
      /@media \(max-width:\s*760px\)[\s\S]*?\.rawThree\s*\{[^}]*left:\s*50%[^}]*transform:\s*translateX\(-50%\)/,
    );
    expect(stylesheet).toMatch(
      /@media \(max-width:\s*760px\)[\s\S]*?\.rawPhoto \.mediaLabel\s*\{[^}]*padding:\s*0\.375rem 0\.5rem[^}]*bottom:\s*0\.375rem/,
    );
  });

  it("keeps all temporary imagery in named replacement slots", () => {
    expect(Object.keys(homepageV3ImageSlots)).toEqual([
      "heroFinishedArtwork",
      "heroRealMoment",
      "heroPrintedProduct",
      "beginProductFormats",
      "beginOccasions",
      "beginPhotoHelp",
      "signatureOriginalPhotos",
      "signatureFinishedArtwork",
      "canvasProductImage",
      "wallBannerProductImage",
      "rollupProductImage",
      "graveCoverProductImage",
      "galleryBirthday",
      "galleryMemorial",
      "galleryFamily",
      "galleryCultural",
      "customerStoryImage",
    ]);
    expect(homepageV3ImageSlots.heroFinishedArtwork.src)
      .toBe("/media/home/homepage-hero-finished-artwork.webp");
    expect(homepageV3ImageSlots.heroRealMoment.src)
      .toBe("/media/home/homepage-hero-real-customer-moment.webp");
    expect(homepageV3ImageSlots.heroPrintedProduct.src)
      .toBe("/media/home/homepage-hero-printed-canvas.webp");
    expect(homepageV3ImageSlots.beginProductFormats.src)
      .toBe("/media/home/homepage-begin-product-formats-v2.webp");
    expect(homepageV3ImageSlots.beginOccasions.src)
      .toBe("/media/home/homepage-begin-occasions.webp");
    expect(homepageV3ImageSlots.beginPhotoHelp.src)
      .toBe("/media/home/homepage-begin-photo-help.webp");
    expect(homepageV3ImageSlots.canvasProductImage.src)
      .toBe("/media/home/homepage-product-canvas.webp");
    expect(homepageV3ImageSlots.wallBannerProductImage.src)
      .toBe("/media/home/homepage-product-wall-banner-birthday.webp");
    expect(homepageV3ImageSlots.rollupProductImage.src)
      .toBe("/media/home/homepage-product-roll-up-banner.webp");
    expect(homepageV3ImageSlots.graveCoverProductImage.src)
      .toBe("/media/home/homepage-product-grave-cover.webp");
  });

  it("selects the five approved homepage artworks in their curated mosaic order", () => {
    const approvedIds = [
      "ed3f5c8db693d7f93782151c2362789d2bd31b0a39539e022ae5d39eaa1ef790",
      "88e63ad4c403d5bcdb37f2ee2f142d63100c970b43808f82f5b6ca21a1aea5aa",
      "a62ca0891fb346b22d7854d9967cedc29c1acdeb56e9a65a003aedac9c55f49d",
      "7455ae174913c7653dfd5a5dff6219af0e7d9aea293bb6d2fb9178ece780be1b",
      "24e5c8fc91b9ca15354e1404b3abc79835972ee7d33f99372c6f2cb22cc3106f",
    ];
    const items = [
      galleryItem(approvedIds[4], {
        productTypeSlug: "roll-up-banner",
        productSlug: "roll-up-banner",
        width: 505,
        height: 1200,
      }),
      galleryItem(approvedIds[2], {
        productTypeSlug: "wall-hanging-banners",
        productSlug: "custom-themed-wall-banner",
        width: 1200,
        height: 600,
      }),
      galleryItem(approvedIds[0], {
        width: 1200,
        height: 846,
      }),
      galleryItem(approvedIds[1], {
        width: 826,
        height: 1200,
      }),
      galleryItem(approvedIds[3], {
        productTypeSlug: "grave-cover",
        productSlug: "grave-cover",
        width: 600,
        height: 1200,
      }),
      galleryItem("unapproved-artwork"),
    ];

    expect(selectHomepageGalleryItems(items).map(({ item, slot }) => [item.id, slot])).toEqual([
      [approvedIds[0], "canvas-landscape"],
      [approvedIds[1], "canvas-portrait"],
      [approvedIds[2], "wall-banner"],
      [approvedIds[3], "grave-cover"],
      [approvedIds[4], "roll-up-banner"],
    ]);
  });

  it("presents the gallery as four product formats instead of occasion filters", () => {
    render(<HomepageV3 registry={defaultProductRegistry} />);

    expect(screen.getByRole("heading", { name: "Real designs across every format." }))
      .toBeInTheDocument();
    expect(screen.getByText(
      "Explore finished Canvas, Wall Banner, Roll-up Banner and Grave Cover designs created by R&R Gallery.",
    )).toBeInTheDocument();

    const productLinks = screen.getByRole("navigation", { name: "Design gallery products" });
    expect(productLinks).toHaveTextContent("Canvas");
    expect(productLinks).toHaveTextContent("Wall Banner");
    expect(productLinks).toHaveTextContent("Roll-up Banner");
    expect(productLinks).toHaveTextContent("Grave Cover");
    expect(productLinks).not.toHaveTextContent("Birthday");
  });

  it("renders Design Gallery images and opens their public detail pages", () => {
    const birthday = galleryItem(
      "a62ca0891fb346b22d7854d9967cedc29c1acdeb56e9a65a003aedac9c55f49d",
      {
      occasionSlug: "birthday",
      subOccasion: "21st Birthday",
      productTypeSlug: "wall-hanging-banners",
      productSlug: "custom-themed-wall-banner",
      altText: "A real 21st birthday wall banner",
      },
    );

    render(<HomepageV3 registry={defaultProductRegistry} galleryItems={[birthday]} />);

    expect(screen.getByRole("img", { name: birthday.altText }).getAttribute("src"))
      .toContain(encodeURIComponent(`/gallery-images/${birthday.id}?v=${birthday.contentHash}`));
    expect(screen.getByRole("link", { name: `View design details: ${birthday.altText}` }))
      .toHaveAttribute(
        "href",
        "/designs/21st-birthday-a62ca089",
      );
  });

  it("identifies every curated artwork by its product format", () => {
    const items = [
      galleryItem("ed3f5c8db693d7f93782151c2362789d2bd31b0a39539e022ae5d39eaa1ef790"),
      galleryItem("88e63ad4c403d5bcdb37f2ee2f142d63100c970b43808f82f5b6ca21a1aea5aa", {
        productSlug: "custom-themed-canvas",
        width: 1456,
        height: 2076,
      }),
      galleryItem("a62ca0891fb346b22d7854d9967cedc29c1acdeb56e9a65a003aedac9c55f49d", {
        productTypeSlug: "wall-hanging-banners",
        productSlug: "custom-themed-wall-banner",
        width: 1200,
        height: 600,
      }),
      galleryItem("7455ae174913c7653dfd5a5dff6219af0e7d9aea293bb6d2fb9178ece780be1b", {
        productTypeSlug: "grave-cover",
        productSlug: "grave-cover",
        width: 600,
        height: 1200,
      }),
      galleryItem("24e5c8fc91b9ca15354e1404b3abc79835972ee7d33f99372c6f2cb22cc3106f", {
        productTypeSlug: "roll-up-banner",
        productSlug: "roll-up-banner",
        width: 505,
        height: 1200,
      }),
    ];

    render(<HomepageV3 registry={defaultProductRegistry} galleryItems={items} />);

    expect(screen.getAllByText("Canvas", { selector: "figcaption" })).toHaveLength(2);
    expect(screen.getByText("Wall Banner", { selector: "figcaption" })).toBeInTheDocument();
    expect(screen.getByText("Grave Cover", { selector: "figcaption" })).toBeInTheDocument();
    expect(screen.getByText("Roll-up Banner", { selector: "figcaption" })).toBeInTheDocument();
  });

  it("keeps gallery artworks lazy so they do not compete with the homepage LCP image", () => {
    const landscape = galleryItem(
      "ed3f5c8db693d7f93782151c2362789d2bd31b0a39539e022ae5d39eaa1ef790",
      { altText: "Landscape canvas" },
    );
    const portrait = galleryItem(
      "88e63ad4c403d5bcdb37f2ee2f142d63100c970b43808f82f5b6ca21a1aea5aa",
      {
        altText: "Portrait canvas",
        productSlug: "custom-themed-canvas",
        width: 1456,
        height: 2076,
      },
    );

    render(<HomepageV3
      registry={defaultProductRegistry}
      galleryItems={[landscape, portrait]}
    />);

    expect(screen.getByRole("img", { name: landscape.altText }))
      .toHaveAttribute("loading", "lazy");
    expect(screen.getByRole("img", { name: landscape.altText }).getAttribute("src"))
      .toContain("/_next/image?url=");
    expect(screen.getByRole("img", { name: portrait.altText }))
      .toHaveAttribute("loading", "lazy");
  });
});
