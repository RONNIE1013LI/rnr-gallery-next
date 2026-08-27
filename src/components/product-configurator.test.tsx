import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfigurationSchema } from "@/domain/configuration/schemas";
import { getProductBySlug } from "@/domain/catalogue/products";
import {
  declaredImageWidth,
  productionCandidateFor,
} from "@/test/image-candidate-assertions";
import { ProductConfigurator } from "./product-configurator";
import {
  defaultProductRegistry,
  parseProductRegistry,
} from "@/domain/catalogue/product-registry";
import styles from "./storefront.module.css";

const analytics = vi.hoisted(() => ({
  emitAnalyticsEvent: vi.fn<(event: unknown) => boolean>(() => true),
}));

vi.mock("@/domain/analytics/client", () => analytics);

const product = getProductBySlug("digital-oil-painting-canvas")!;
const schema = getConfigurationSchema(product.key)!;

function enabledAustraliaRegistry() {
  const registry = structuredClone(defaultProductRegistry);
  for (const marketProduct of registry.markets.AU.products) {
    for (const size of marketProduct.sizes) size.amountInclTaxCents = 40_000;
    for (const charge of marketProduct.charges) charge.amountInclTaxCents = 3_000;
  }
  const canvas = registry.markets.AU.products.find(
    (entry) => entry.productKey === product.key,
  )!;
  canvas.sizes.find((size) => size.sizeKey === schema.defaultSizeKey)!.amountInclTaxCents = 40_000;
  for (const fee of registry.markets.AU.peoplePets.fees) {
    fee.amountInclTaxCents = fee.count * 6_000;
  }
  registry.markets.AU.peoplePets.additionalEachInclTaxCents = 4_000;
  for (const fee of registry.markets.AU.urgentServiceFees) fee.amountInclTaxCents = 10_000;
  for (const shipping of registry.markets.AU.shippingMethods) shipping.amountInclTaxCents = 4_500;
  registry.markets.AU.enabled = true;
  return parseProductRegistry(registry);
}

describe("ProductConfigurator", () => {
  it("starts from a valid size supplied by the landing page", () => {
    const product = getProductBySlug("photo-print-canvas")!;
    const schema = getConfigurationSchema(product.key)!;
    render(
      <ProductConfigurator
        product={product}
        schema={schema}
        orderDate="2026-08-03"
        initialSizeKey="a2"
      />,
    );

    expect(screen.getByRole("radio", { name: /A2/i })).toBeChecked();
  });
  beforeEach(() => {
    localStorage.clear();
    analytics.emitAnalyticsEvent.mockReset();
    analytics.emitAnalyticsEvent.mockReturnValue(true);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows the default configuration and exact price", () => {
    render(
      <ProductConfigurator
        product={product}
        schema={schema}
        orderDate="2026-08-03"
        createId={() => "configured-item"}
      />,
    );

    expect(screen.getByRole("radio", { name: /^A4.*From NZ\$120\.75$/ })).toBeChecked();
    expect(screen.queryByRole("radio", {
      name: /From NZ\$120\.75 incl GST/,
    })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Landscape")).toBeChecked();
    expect(screen.getByLabelText("People or pets in artwork")).toHaveValue("1");
    const orderSummary = screen.getByRole("complementary", { name: "Order summary" });
    expect(within(orderSummary).getByText("NZ$74.75 incl GST")).toBeInTheDocument();
    expect(within(orderSummary).getByText("NZ$46.00 incl GST")).toBeInTheDocument();
    expect(within(orderSummary).getByText("Includes GST (15%)")).toBeInTheDocument();
    expect(within(orderSummary).getByText("NZ$15.75")).toBeInTheDocument();
    expect(within(orderSummary).getByText("NZ$120.75")).toBeInTheDocument();
    expect(within(orderSummary).queryByText(/excl GST/i)).not.toBeInTheDocument();
    expect(screen.getByText(/New Zealand: 2–3 business days/i)).toBeVisible();
    expect(screen.queryByText(/DHL Express.*around 2 days/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Standard delivery.*7–10 days/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/remote areas.*around two weeks/i)).not.toBeInTheDocument();
  });

  it("quotes and stores an Australian configuration only in fixed AUD", () => {
    render(
      <ProductConfigurator
        product={product}
        schema={schema}
        registry={enabledAustraliaRegistry()}
        market="AU"
        orderDate="2026-08-03"
        createId={() => "aud-item"}
      />,
    );

    const summary = screen.getByRole("complementary", { name: "Order summary" });
    expect(within(summary).getByText("A$460.00 AUD")).toBeVisible();
    expect(within(summary).queryByText("Australian GST not charged"))
      .not.toBeInTheDocument();
    expect(within(summary).queryByText("A$0.00 AUD")).not.toBeInTheDocument();
    expect(within(summary).queryByText(/NZ\$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/New Zealand: 2–3 business days/i)).not.toBeInTheDocument();
    expect(screen.getByText(/DHL Express.*around 2 days/i)).toBeVisible();
    expect(screen.getByText(/Standard delivery.*7–10 days/i)).toBeVisible();
    expect(screen.getByText(/remote areas.*around two weeks/i)).toBeVisible();
    fireEvent.click(screen.getByText("Send Photos After Ordering"));
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));
    expect(JSON.parse(localStorage.getItem("rnr:commerce:v1:guest:cart")!).items[0].price)
      .toMatchObject({ market: "AU", currency: "AUD", totalInclGstCents: 46_000 });
  });

  it("hides delivery choices and stores post for Australian orders", () => {
    render(
      <ProductConfigurator
        product={product}
        schema={schema}
        registry={enabledAustraliaRegistry()}
        market="AU"
        orderDate="2026-08-03"
        createId={() => "aud-post-item"}
      />,
    );

    expect(screen.queryByRole("radiogroup", { name: "Delivery" })).not.toBeInTheDocument();
    expect(screen.queryByText("Pickup")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Send Photos After Ordering"));
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));

    const stored = JSON.parse(localStorage.getItem("rnr:commerce:v1:guest:cart")!);
    expect(stored.items[0].deliveryPreference).toBe("post");
  });

  it("presents every available size as a selectable card with its minimum price", () => {
    render(
      <ProductConfigurator
        product={product}
        schema={schema}
        orderDate="2026-08-03"
      />,
    );

    const sizePicker = screen.getByRole("radiogroup", { name: "Size" });
    expect(within(sizePicker).getAllByRole("radio")).toHaveLength(5);
    expect(
      within(sizePicker).getByRole("radio", {
        name: /^A0.*From NZ\$368\.00$/,
      }),
    ).not.toBeChecked();

    fireEvent.click(
      within(sizePicker).getByRole("radio", {
        name: /^A0.*From NZ\$368\.00$/,
      }),
    );

    expect(
      within(sizePicker).getByRole("radio", {
        name: /^A0.*From NZ\$368\.00$/,
      }),
    ).toBeChecked();
    expect(
      within(screen.getByRole("complementary", { name: "Order summary" }))
        .getByText("A0 — 118.9 × 84.1 cm"),
    ).toBeInTheDocument();
  });

  it("presents delivery as two radio choices and persists the selected option", () => {
    render(
      <ProductConfigurator
        product={product}
        schema={schema}
        orderDate="2026-08-03"
        createId={() => "pickup-item"}
      />,
    );

    const delivery = screen.getByRole("radiogroup", { name: "Delivery" });
    expect(within(delivery).getAllByRole("radio")).toHaveLength(2);
    expect(within(delivery).getByRole("radio", { name: "Post" })).toBeChecked();

    fireEvent.click(within(delivery).getByRole("radio", { name: "Pickup" }));
    fireEvent.click(screen.getByText("Send Photos After Ordering"));
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));

    expect(within(delivery).getByRole("radio", { name: "Pickup" })).toBeChecked();
    expect(JSON.parse(localStorage.getItem("rnr:commerce:v1:guest:cart")!).items[0]).toMatchObject({
      id: "pickup-item",
      deliveryPreference: "pickup",
    });
  });

  it("applies the latest explicit delivery choice to the whole cart", () => {
    const first = render(
      <ProductConfigurator
        product={product}
        schema={schema}
        orderDate="2026-08-03"
        createId={() => "first-item"}
      />,
    );
    fireEvent.click(screen.getByText("Send Photos After Ordering"));
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));
    first.unmount();

    render(
      <ProductConfigurator
        product={product}
        schema={schema}
        orderDate="2026-08-03"
        createId={() => "second-item"}
      />,
    );
    expect(screen.getByText("This choice applies to your whole order.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Pickup" }));
    fireEvent.click(screen.getByText("Send Photos After Ordering"));
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));

    const stored = JSON.parse(localStorage.getItem("rnr:commerce:v1:guest:cart")!);
    expect(stored.items).toHaveLength(2);
    expect(stored.items.every((item: { deliveryPreference: string }) => item.deliveryPreference === "pickup")).toBe(true);
  });

  it("shows size-card starting prices in pure black at the existing text size", () => {
    const css = readFileSync("src/components/storefront.module.css", "utf8");

    expect(css).toMatch(
      /\.sizeOptionBody\s*>\s*span\s*\{[\s\S]*?color:\s*#000;[\s\S]*?font-size:\s*0\.875rem;/,
    );
  });

  it("uses the shared capsule hierarchy for file upload and the post-add cart action", () => {
    const css = readFileSync("src/components/storefront.module.css", "utf8");

    expect(css).toMatch(
      /\.uploadButton\s*\{[\s\S]*?min-height:\s*48px;[\s\S]*?color:\s*var\(--gallery-green\);[\s\S]*?background:\s*transparent;[\s\S]*?border:\s*1px solid var\(--gallery-green\);[\s\S]*?border-radius:\s*var\(--radius-button\);/,
    );
    expect(css).toMatch(
      /\.addedMessageAction\s*\{[\s\S]*?min-height:\s*48px;[\s\S]*?color:\s*#fff;[\s\S]*?background:\s*var\(--gallery-green\);[\s\S]*?border-radius:\s*var\(--radius-button\);/,
    );
  });

  it("uses the server-supplied registry policy for preview prices", () => {
    const pricing = structuredClone(defaultProductRegistry.pricing);
    pricing.peoplePetsFeesExGstCents[0] = 4_500;
    render(
      <ProductConfigurator
        product={product}
        schema={schema}
        pricing={pricing}
        orderDate="2026-08-03"
      />,
    );

    expect(screen.getByText("NZ$51.75 incl GST")).toBeInTheDocument();
    expect(screen.getByText("NZ$16.50")).toBeInTheDocument();
    expect(screen.getByText("NZ$126.50")).toBeInTheDocument();
  });

  it("keeps a product preview beside the live order summary while configuring", () => {
    render(
      <ProductConfigurator
        product={product}
        schema={schema}
        orderDate="2026-08-03"
      />,
    );

    const preview = screen.getByRole("region", { name: "Artwork preview" });
    const previewImage = within(preview).getByRole("img", { name: product.image.alt });
    expect(previewImage)
      .toHaveAttribute(
        "sizes",
        "(max-width: 340px) calc(100vw - 1.7rem), (max-width: 500px) 92vw, (max-width: 650px) calc(100vw - 2.5rem), (max-width: 820px) 92vw, (max-width: 1103px) calc(87vw - 20rem), (max-width: 1565px) 58vw, 907px",
      );
    expect(declaredImageWidth(previewImage, 350)).toBeCloseTo(322, 1);
    expect(productionCandidateFor(previewImage, 350)).toBe(750);
    expect(within(preview).getByText("Example shown")).toBeVisible();
    expect(within(preview).queryByText("Your custom artwork")).not.toBeInTheDocument();
    expect(
      within(preview).getByText("Preview your selection as you personalise your order."),
    ).toBeVisible();
    expect(screen.getByRole("complementary", { name: "Order summary" })).toBeVisible();
  });

  it("flattens the sticky preview sidebar on mobile so it cannot cover the form", () => {
    const css = readFileSync("src/components/storefront.module.css", "utf8");
    const sidebarRule = css.lastIndexOf(".configuratorSidebar");
    const mobileRulesStart = css.lastIndexOf("@media (max-width: 820px)", sidebarRule);
    const mobileRulesEnd = css.indexOf("@media", sidebarRule);
    const mobileRules = css.slice(mobileRulesStart, mobileRulesEnd);

    expect(mobileRules).toMatch(
      /\.configuratorSidebar\s*\{[\s\S]*?display:\s*contents;/,
    );
  });

  it("uses the sticky sidebar's full height so Safari stops it before related designs", () => {
    const css = readFileSync("src/components/storefront.module.css", "utf8");
    const desktopSidebarRule = css.match(
      /\.configuratorSidebar\s*\{([\s\S]*?)\}/,
    )?.[1];

    expect(desktopSidebarRule).toMatch(/position:\s*sticky;/);
    expect(desktopSidebarRule).not.toMatch(/max-height:/);
  });

  it("contains the localized iOS date control inside its mobile field", () => {
    const css = readFileSync("src/components/storefront.module.css", "utf8");

    expect(css).toMatch(
      /\.configuratorForm \.fieldGrid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/,
    );
    expect(css).toMatch(
      /\.formField input\[type=["']date["']\]\s*\{[\s\S]*?display:\s*block;[\s\S]*?inline-size:\s*100%;[\s\S]*?min-inline-size:\s*0;[\s\S]*?max-inline-size:\s*100%;[\s\S]*?-webkit-appearance:\s*none;[\s\S]*?appearance:\s*none;/,
    );
  });

  it("presents related designs as image-only links to the matching configurator", () => {
    render(
      <ProductConfigurator
        product={product}
        schema={schema}
        orderDate="2026-08-03"
        relatedDesigns={[
          {
            id: "a".repeat(64),
            title: "Memorial floral canvas",
            altText: "Memorial floral canvas",
            imageUrl: `/gallery-images/${"a".repeat(64)}?v=${"b".repeat(64)}`,
            width: 1200,
            height: 1600,
            productSlug: "digital-oil-painting-canvas",
          },
        ]}
      />,
    );

    expect(screen.getByRole("region", { name: "Related designs" })).toBeVisible();
    expect(screen.getByText("Made by R&R")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Design inspiration" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Memorial floral canvas" })).toHaveAttribute(
      "href",
      `/products/digital-oil-painting-canvas/configure?design=${"a".repeat(64)}`,
    );
    expect(screen.getByRole("link", { name: "View all designs" })).toHaveAttribute(
      "href",
      "/design-gallery",
    );
    expect(screen.queryByRole("heading", { name: "Memorial floral canvas" })).not.toBeInTheDocument();
    expect(screen.queryByText("Configure with this design")).not.toBeInTheDocument();
    const relatedImage = screen.getByRole("img", { name: "Memorial floral canvas" });
    expect(relatedImage)
      .toHaveAttribute(
        "sizes",
        "(max-width: 340px) calc((100vw - 2.45rem) / 2), (max-width: 500px) calc(46vw - 0.375rem), (max-width: 650px) calc((100vw - 3.25rem) / 2), (max-width: 767px) calc(46vw - 0.375rem), (max-width: 1020px) 29.74vw, (max-width: 1565px) 21.95vw, 345px",
      );
    expect(declaredImageWidth(relatedImage, 350)).toBeCloseTo(155, 1);
    expect(productionCandidateFor(relatedImage, 350)).toBe(320);
  });

  it("updates the displayed size and order summary when orientation changes", () => {
    render(
      <ProductConfigurator
        product={product}
        schema={schema}
        orderDate="2026-08-03"
      />,
    );

    expect(screen.getByText("Dimensions are always shown as width × height.")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Portrait"));
    expect(screen.getByRole("radio", {
      name: /^A4 — 21 × 29\.7 cm.*From NZ\$120\.75$/,
    })).toBeChecked();
    expect(within(screen.getByRole("complementary", { name: "Order summary" }))
      .getByText("A4 — 21 × 29.7 cm")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Artwork preview" }))
      .getByText("A4 — 21 × 29.7 cm")).toBeInTheDocument();
  });

  it("shows practical examples for artwork wording and notes", () => {
    render(
      <ProductConfigurator
        product={product}
        schema={schema}
        orderDate="2026-08-03"
      />,
    );

    const designTextField = screen.getByLabelText("Text for your design");
    const designNotesField = screen.getByLabelText("Design notes");

    expect(designTextField).toHaveAttribute(
      "placeholder",
      "e.g. Top text: HAPPY 1ST BIRTHDAY\nBottom text: ETI JUNIOR COLLINS",
    );
    expect(designNotesField).toHaveAttribute(
      "placeholder",
      "e.g. Background: Orange and white Polynesian pattern design",
    );
    expect(designTextField).toHaveClass(styles.exampleTextarea);
    expect(designNotesField).toHaveClass(styles.exampleTextarea);
  });

  it("skips artwork direction for Photo Print Canvas", () => {
    const photoPrintCanvas = getProductBySlug("photo-print-canvas")!;
    const photoPrintSchema = getConfigurationSchema(photoPrintCanvas.key)!;
    render(
      <ProductConfigurator
        product={photoPrintCanvas}
        schema={photoPrintSchema}
        orderDate="2026-08-03"
      />,
    );

    expect(screen.queryByRole("heading", { name: "Artwork direction" }))
      .not.toBeInTheDocument();
    expect(screen.queryByLabelText("Text for your design")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Design notes")).not.toBeInTheDocument();

    const timingStep = screen.getByRole("heading", { name: "Timing and delivery" })
      .closest("section");
    expect(timingStep).not.toBeNull();
    expect(within(timingStep!).getByText("03")).toBeInTheDocument();
  });

  it("does not render an empty format selector for a one-size product", () => {
    const rollUp = getProductBySlug("roll-up-banner")!;
    const rollUpSchema = getConfigurationSchema(rollUp.key)!;
    render(
      <ProductConfigurator
        product={rollUp}
        schema={rollUpSchema}
        orderDate="2026-08-03"
      />,
    );

    expect(screen.queryByRole("radiogroup", { name: "Size" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Choose the format" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Upload original photos" })).toBeInTheDocument();
  });

  it("shows Grave Cover as one 100 × 200 cm format without orientation", () => {
    const graveCover = getProductBySlug("grave-cover")!;
    const graveCoverSchema = getConfigurationSchema(graveCover.key)!;
    render(
      <ProductConfigurator
        product={graveCover}
        schema={graveCoverSchema}
        orderDate="2026-08-03"
        createId={() => "grave-cover-item"}
      />,
    );

    expect(screen.queryByRole("radiogroup", { name: "Size" })).not.toBeInTheDocument();
    expect(screen.queryByText("Orientation")).not.toBeInTheDocument();
    expect(screen.queryByText("Portrait")).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Artwork preview" }))
      .getByText("100 × 200 cm")).toBeInTheDocument();
    expect(within(screen.getByRole("complementary", { name: "Order summary" }))
      .getByText("100 × 200 cm")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Send Photos After Ordering"));
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));
    const storedItem = JSON.parse(localStorage.getItem("rnr:commerce:v1:guest:cart")!).items[0];
    expect(storedItem).toMatchObject({
      productKey: "grave-cover",
      sizeKey: "standard",
      sizeLabel: "100 × 200 cm",
    });
    expect(storedItem).not.toHaveProperty("orientation");
  });

  it("updates the quote and persists the configured item", () => {
    render(
      <ProductConfigurator
        product={product}
        schema={schema}
        orderDate="2026-08-03"
        createId={() => "configured-item"}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Increase people or pets" }));
    expect(screen.getByText("NZ$69.00 incl GST")).toBeInTheDocument();
    expect(screen.getByText("NZ$18.75")).toBeInTheDocument();
    expect(screen.getByText("NZ$143.75")).toBeInTheDocument();

    const completionDate = screen.getByLabelText("Production completion date");
    expect(completionDate.closest("div")).toHaveClass(styles.timingFields);
    fireEvent.change(completionDate, {
      target: { value: "2026-08-20" },
    });
    fireEvent.click(screen.getByText("Send Photos After Ordering"));
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));

    const stored = JSON.parse(localStorage.getItem("rnr:commerce:v1:guest:cart")!);
    expect(stored.items).toHaveLength(1);
    expect(stored.items[0]).toMatchObject({
      id: "configured-item",
      productKey: product.key,
      peoplePets: 2,
      neededDate: "2026-08-20",
      deliveryPreference: "post",
      quantity: 1,
    });
    expect(screen.getByRole("link", { name: "View cart" })).toHaveAttribute(
      "href",
      "/cart",
    );
    expect(screen.getByRole("link", { name: "View cart" })).toHaveAttribute(
      "class",
      expect.stringContaining("addedMessageAction"),
    );
  });

  it("tracks the persisted configured item as an NZD add_to_cart", () => {
    render(
      <ProductConfigurator
        product={product}
        schema={schema}
        orderDate="2026-08-03"
        createId={() => "analytics-item"}
      />,
    );

    fireEvent.click(screen.getByText("Send Photos After Ordering"));
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));

    expect(JSON.parse(localStorage.getItem("rnr:commerce:v1:guest:cart")!).items)
      .toHaveLength(1);
    expect(analytics.emitAnalyticsEvent).toHaveBeenCalledWith({
      event: "add_to_cart",
      currency: "NZD",
      value: 105,
      items: [{
        item_id: "digital-oil-painting-canvas",
        item_name: "Digital Oil Painting Canvas",
        item_variant: "a4",
        price: 105,
        quantity: 1,
      }],
    });
  });

  it("keeps the persisted cart and success UI when analytics throws", () => {
    analytics.emitAnalyticsEvent.mockImplementation(() => {
      throw new Error("analytics unavailable");
    });
    render(
      <ProductConfigurator
        product={product}
        schema={schema}
        orderDate="2026-08-03"
        createId={() => "fail-open-item"}
      />,
    );

    fireEvent.click(screen.getByText("Send Photos After Ordering"));
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));

    expect(JSON.parse(localStorage.getItem("rnr:commerce:v1:guest:cart")!).items)
      .toEqual([expect.objectContaining({ id: "fail-open-item" })]);
    expect(screen.getByRole("link", { name: "View cart" })).toBeVisible();
  });

  it("keeps pasted artwork text within the server checkout boundary", () => {
    render(
      <ProductConfigurator
        product={product}
        schema={schema}
        orderDate="2026-08-03"
        createId={() => "bounded-text-item"}
      />,
    );
    fireEvent.change(screen.getByLabelText("Text for your design"), {
      target: { value: "A".repeat(5_001) },
    });
    fireEvent.change(screen.getByLabelText("Design notes"), {
      target: { value: "B".repeat(5_001) },
    });
    fireEvent.click(screen.getByText("Send Photos After Ordering"));
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));

    const stored = JSON.parse(localStorage.getItem("rnr:commerce:v1:guest:cart")!).items[0];
    expect(stored.designText).toHaveLength(5_000);
    expect(stored.notes).toHaveLength(5_000);
    expect(screen.getByLabelText("Text for your design")).toHaveAttribute("maxlength", "5000");
    expect(screen.getByLabelText("Design notes")).toHaveAttribute("maxlength", "5000");
  });

  it("caps the people or pets control at the server maximum", () => {
    render(
      <ProductConfigurator
        product={product}
        schema={schema}
        orderDate="2026-08-03"
      />,
    );

    const increase = screen.getByRole("button", { name: "Increase people or pets" });
    for (let click = 0; click < 25; click += 1) fireEvent.click(increase);

    expect(screen.getByLabelText("People or pets in artwork")).toHaveValue("20");
    expect(increase).toBeDisabled();
  });

  it("uploads source files privately and stores only their references", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          reference: {
            id: "private-reference",
            originalName: "source.jpg",
            mimeType: "image/jpeg",
            size: 3,
          },
        }),
      }),
    );
    render(
      <ProductConfigurator
        product={product}
        schema={schema}
        orderDate="2026-08-03"
        createId={() => "configured-item"}
      />,
    );

    fireEvent.change(screen.getByLabelText("Choose files"), {
      target: { files: [new File([new Uint8Array([1, 2, 3])], "source.jpg", { type: "image/jpeg" })] },
    });

    expect(await screen.findByText("Photo 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));
    const stored = JSON.parse(localStorage.getItem("rnr:commerce:v1:guest:cart")!);
    expect(stored.items[0].uploadReferences).toEqual(["private-reference"]);
  });

  it("keeps uploaded files when switching to send later and back", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ reference: { id: "kept-reference", originalName: "kept.jpg" } }),
    }));
    render(<ProductConfigurator product={product} schema={schema} orderDate="2026-08-03" />);

    fireEvent.change(screen.getByLabelText("Choose files"), {
      target: { files: [new File([new Uint8Array([1])], "kept.jpg", { type: "image/jpeg" })] },
    });
    expect(await screen.findByText("Photo 1")).toBeVisible();

    fireEvent.click(screen.getByText("Send Photos After Ordering"));
    expect(screen.queryByText("Photo 1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to cart" })).toBeEnabled();

    fireEvent.click(screen.getByText("Upload Photos Now"));
    expect(screen.getByText("Photo 1")).toBeVisible();
  });

  it("uses clear photo choices and confirmed trust information", () => {
    render(<ProductConfigurator product={product} schema={schema} orderDate="2026-08-03" />);

    expect(screen.getByText("Upload Photos Now")).toBeVisible();
    expect(screen.getByText("Upload now — recommended for preserving original quality.")).toBeVisible();
    expect(screen.getByText("Send Photos After Ordering")).toBeVisible();
    expect(screen.getByText((_content, element) => (
      element?.tagName === "SMALL"
      && element.textContent === "Send later — send by Messenger, Email or WhatsApp after ordering."
    ))).toBeVisible();
    expect(screen.getByText("Proof before printing")).toBeVisible();
    expect(document.querySelector("form#customise")).not.toBeNull();
  });

  it("accepts photo 21 and starts charging the Custom Canvas extra-photo fee", async () => {
    const customCanvas = getProductBySlug("custom-themed-canvas")!;
    const customCanvasSchema = getConfigurationSchema(customCanvas.key)!;
    let uploadNumber = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      uploadNumber += 1;
      return {
        ok: true,
        json: async () => ({
          reference: {
            id: `00000000-0000-4000-8000-${String(uploadNumber).padStart(12, "0")}`,
            originalName: `photo-${uploadNumber}.jpg`,
          },
        }),
      };
    }));
    render(
      <ProductConfigurator
        product={customCanvas}
        schema={customCanvasSchema}
        orderDate="2026-08-03"
      />,
    );
    const files = Array.from({ length: 21 }, (_, index) =>
      new File([new Uint8Array([index + 1])], `photo-${index + 1}.jpg`, { type: "image/jpeg" }),
    );

    fireEvent.change(screen.getByLabelText("Choose files"), {
      target: { files },
    });

    expect(await screen.findByText("Photo 21", undefined, { timeout: 5_000 })).toBeInTheDocument();
    const summary = screen.getByRole("complementary", { name: "Order summary" });
    expect(within(summary).getByText("Extra photos")).toBeInTheDocument();
    expect(within(summary).getByText("NZ$5.75 incl GST")).toBeInTheDocument();
    expect(within(summary).getByText("NZ$141.45")).toBeInTheDocument();
    expect(screen.queryByText(/Choose no more than 20 source photos/)).not.toBeInTheDocument();
  });

  it("separates the compact remove icon from its accessible upload-preview hit area", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          reference: {
            id: "private-reference",
            originalName: "source.jpg",
            mimeType: "image/jpeg",
            size: 3,
          },
        }),
      }),
    );
    render(
      <ProductConfigurator
        product={product}
        schema={schema}
        orderDate="2026-08-03"
      />,
    );

    fireEvent.change(screen.getByLabelText("Choose files"), {
      target: { files: [new File([new Uint8Array([1, 2, 3])], "source.jpg", { type: "image/jpeg" })] },
    });

    const remove = await screen.findByRole("button", { name: "Remove Photo 1" });
    expect(remove).toHaveClass(styles.uploadPreviewRemove);
    const icon = within(remove).getByText("×");
    expect(icon).toHaveClass(styles.uploadPreviewRemoveIcon);
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("shows the server rejection beside the upload control", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "The image contents do not match the selected file type." }),
    }));
    render(<ProductConfigurator product={product} schema={schema} orderDate="2026-08-03" />);

    fireEvent.change(screen.getByLabelText("Choose files"), {
      target: { files: [new File(["not-an-image"], "fake.jpg", { type: "image/jpeg" })] },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The image contents do not match the selected file type.",
    );
  });

  it("manages a Roll-Up main photo and paid extra background removal", async () => {
    const rollUp = getProductBySlug("roll-up-banner")!;
    const rollUpSchema = getConfigurationSchema(rollUp.key)!;
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ reference: { id: "photo-one", originalName: "one.jpg" } }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ reference: { id: "photo-two", originalName: "two.jpg" } }) }),
    );
    render(<ProductConfigurator product={rollUp} schema={rollUpSchema} orderDate="2026-08-03" />);

    const orderSummary = screen.getByRole("complementary", { name: "Order summary" });
    expect(within(orderSummary).getByText("NZ$264.50 incl GST")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Choose files"), {
      target: { files: [
        new File([new Uint8Array([1])], "one.jpg", { type: "image/jpeg" }),
        new File([new Uint8Array([2])], "two.jpg", { type: "image/jpeg" }),
      ] },
    });

    expect((await screen.findAllByText("Main photo"))[0]).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /remove background/i }));
    expect(screen.getByRole("button", { name: /background removal/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("1 × NZ$20.00 incl GST")).toBeInTheDocument();
    expect(screen.getByText("NZ$284.50")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Set as main" }));
    expect(screen.getAllByText("Main photo")).toHaveLength(2);
    expect(screen.getByText("Extra background removals").nextElementSibling).toHaveTextContent("0");
  });

  it("adds the GST-inclusive fourth-day fee only after confirmation", () => {
    render(
      <ProductConfigurator
        product={product}
        schema={schema}
        orderDate="2026-08-03"
        createId={() => "urgent-item"}
      />,
    );
    fireEvent.click(screen.getByText("Send Photos After Ordering"));
    fireEvent.change(screen.getByLabelText("Production completion date"), {
      target: { value: "2026-08-07" },
    });

    const orderSummary = screen.getByRole("complementary", { name: "Order summary" });
    const completionDateField = screen
      .getByLabelText("Production completion date")
      .closest("label");
    const urgentConfirmation = screen
      .getByLabelText("Confirm urgent service")
      .closest("label");
    const delivery = screen.getByRole("radiogroup", { name: "Delivery" });

    expect(screen.getByText(
      "I need production completed by the selected date and confirm urgent service.",
    )).toBeInTheDocument();
    const urgentDetails = urgentConfirmation?.querySelectorAll("small");
    expect(urgentDetails).toHaveLength(2);
    expect(urgentDetails?.[0]).toHaveTextContent("NZ$50.00 incl GST");
    expect(urgentDetails?.[1]).toHaveTextContent(
      "Delivery time is not included in this timeframe.",
    );
    expect(completionDateField?.nextElementSibling).toBe(urgentConfirmation);
    expect(urgentConfirmation?.nextElementSibling).toBe(delivery);
    const css = readFileSync("src/components/storefront.module.css", "utf8");
    expect(css).toMatch(
      /\.timingFields \.urgentConfirmation\s*\{[\s\S]*?margin-top:\s*0;/,
    );
    expect(screen.getAllByText("NZ$50.00 incl GST")).toHaveLength(1);
    expect(within(orderSummary).queryByText("NZ$50.00 incl GST")).not.toBeInTheDocument();
    expect(within(orderSummary).getByText("NZ$120.75")).toBeInTheDocument();
    const addButton = screen.getByRole("button", { name: "Confirm urgent service to continue" });
    expect(addButton).toBeDisabled();

    fireEvent.click(screen.getByLabelText("Confirm urgent service"));
    expect(within(orderSummary).getByText("NZ$50.00 incl GST")).toBeInTheDocument();
    expect(within(orderSummary).getByText("NZ$170.75")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to cart" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));
    const stored = JSON.parse(localStorage.getItem("rnr:commerce:v1:guest:cart")!);
    expect(stored.items[0]).toMatchObject({
      urgentServiceConfirmed: true,
      urgentFeeInclGstCents: 5_000,
    });
  });

  it("uses the selected design in the product preview without adding a second panel", () => {
    const designId = "a".repeat(64);
    render(
      <ProductConfigurator
        product={product}
        schema={schema}
        orderDate="2026-08-03"
        selectedDesign={{
          id: designId,
          title: "In loving memory",
          altText: "Memorial floral canvas",
          imageUrl: `/gallery-images/${designId}?v=${"b".repeat(64)}`,
          contentHash: "b".repeat(64),
          productSlug: "digital-oil-painting-canvas",
          width: 1200,
          height: 1600,
        }}
      />,
    );

    const preview = screen.getByRole("region", { name: "Artwork preview" });
    expect(within(preview).getByRole("img", { name: "Memorial floral canvas" }))
      .toBeInTheDocument();
    expect(within(preview).getByRole("button", { name: "View full image" })).toBeInTheDocument();
    fireEvent.click(within(preview).getByRole("button", { name: "View full image" }));
    const dialog = screen.getByRole("dialog", { name: "Artwork full image" });
    const close = within(dialog).getByRole("button", { name: "Close image preview" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Artwork full image" })).not.toBeInTheDocument();
    expect(within(preview).getByRole("button", { name: "View full image" })).toHaveFocus();
    expect(screen.queryByRole("heading", { name: "Selected design inspiration" }))
      .not.toBeInTheDocument();
  });

  it("stores the selected gallery design ID without changing the configured price", () => {
    const designId = "a".repeat(64);
    render(
      <ProductConfigurator
        product={product}
        schema={schema}
        orderDate="2026-08-03"
        createId={() => "configured-item"}
        selectedDesign={{
          id: designId,
          title: "In loving memory",
          altText: "Memorial floral canvas",
          imageUrl: `/gallery-images/${designId}?v=${"b".repeat(64)}`,
          contentHash: "b".repeat(64),
          productSlug: "digital-oil-painting-canvas",
          width: 1200,
          height: 1600,
        }}
      />,
    );

    expect(screen.getByText("NZ$120.75")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Send Photos After Ordering"));
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));

    expect(JSON.parse(localStorage.getItem("rnr:commerce:v1:guest:cart")!).items[0]).toMatchObject({
      galleryDesignId: designId,
      price: { totalInclGstCents: 12_075 },
    });
  });
});
