import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProductBySlug } from "@/domain/catalogue/products";
import {
  defaultProductRegistry,
  parseProductRegistry,
} from "@/domain/catalogue/product-registry";
import { getConfigurationSchema } from "@/domain/configuration/schemas";
import { BannerBundleConfigurator } from "./banner-bundle-configurator";

const analytics = vi.hoisted(() => ({
  emitAnalyticsEvent: vi.fn<(event: unknown) => boolean>(() => true),
}));

vi.mock("@/domain/analytics/client", () => analytics);

const product = getProductBySlug("banner-bundle")!;
const schema = getConfigurationSchema(product.key)!;

function enabledAustraliaRegistry() {
  const registry = structuredClone(defaultProductRegistry);
  for (const marketProduct of registry.markets.AU.products) {
    for (const size of marketProduct.sizes) size.amountInclTaxCents = 40_000;
    for (const charge of marketProduct.charges) charge.amountInclTaxCents = 3_000;
  }
  for (const fee of registry.markets.AU.peoplePets.fees) {
    fee.amountInclTaxCents = fee.count * 6_000;
  }
  registry.markets.AU.peoplePets.additionalEachInclTaxCents = 4_000;
  for (const fee of registry.markets.AU.urgentServiceFees) fee.amountInclTaxCents = 10_000;
  registry.markets.AU.enabled = true;
  return parseProductRegistry(registry);
}

describe("BannerBundleConfigurator", () => {
  beforeEach(() => {
    localStorage.clear();
    analytics.emitAnalyticsEvent.mockReset();
    analytics.emitAnalyticsEvent.mockReturnValue(true);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders one shared configurator around two vertical customisation groups", () => {
    render(
      <BannerBundleConfigurator
        product={product}
        schema={schema}
        registry={defaultProductRegistry}
        pricing={defaultProductRegistry.pricing}
        orderDate="2026-08-17"
      />,
    );

    const preview = screen.getByRole("region", { name: "Artwork preview" });
    expect(preview).toBeVisible();
    expect(within(preview).getByRole("img", { name: product.image.alt }))
      .toHaveAttribute(
        "sizes",
        "(max-width: 650px) calc(100vw - 2.5rem), (max-width: 820px) 92vw, (max-width: 1103px) calc(87vw - 20rem), (max-width: 1565px) 58vw, 907px",
      );
    expect(screen.getAllByRole("complementary", { name: "Order summary" })).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Roll-Up Banner customisation" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Wall Banner customisation" })).toBeVisible();
    expect(document.querySelector("form#customise")).not.toBeNull();
    expect(screen.getByText(/New Zealand: 2–3 business days/i)).toBeVisible();
    expect(screen.queryByText(/DHL Express.*around 2 days/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Standard delivery.*7–10 days/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/remote areas.*around two weeks/i)).not.toBeInTheDocument();
  });

  it("makes clear that an urgent date is for production, not delivery", () => {
    render(
      <BannerBundleConfigurator
        product={product}
        schema={schema}
        registry={defaultProductRegistry}
        pricing={defaultProductRegistry.pricing}
        orderDate="2026-08-17"
      />,
    );

    fireEvent.change(screen.getByLabelText("Production completion date"), {
      target: { value: "2026-08-18" },
    });

    expect(screen.getByText(
      "I need production completed by the selected date and confirm urgent service.",
    )).toBeInTheDocument();
    const urgentConfirmation = screen
      .getByLabelText("Confirm urgent service")
      .closest("label");
    const urgentDetails = urgentConfirmation?.querySelectorAll("small");
    expect(urgentDetails).toHaveLength(2);
    expect(urgentDetails?.[1]).toHaveTextContent(
      "Delivery time is not included in this timeframe.",
    );
  });

  it("simplifies Bundle size labels and omits GST only from size-card prices", () => {
    render(
      <BannerBundleConfigurator
        product={product}
        schema={schema}
        registry={defaultProductRegistry}
        pricing={defaultProductRegistry.pricing}
        orderDate="2026-08-17"
      />,
    );

    expect(screen.getByRole("radio", {
      name: "Roll Up Banner + 200 x 100 cm Wall Banner, From NZ$359.99",
    })).toBeChecked();
    expect(screen.getByRole("radio", {
      name: "Roll Up Banner + 300 x 150 cm Wall Banner, From NZ$489.99",
    })).not.toBeChecked();
    expect(screen.queryByRole("radio", {
      name: /85 × 200 cm Roll-Up/,
    })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", {
      name: /incl GST/,
    })).not.toBeInTheDocument();

    const sizePicker = screen.getByRole("radiogroup", { name: "Size" });
    expect(within(sizePicker).getByText("Roll Up Banner +")).toBeVisible();
    expect(within(sizePicker).getAllByText("Wall Banner")).toHaveLength(2);
    expect(within(sizePicker).getByText("200 x 100 cm")).toBeVisible();
    expect(within(sizePicker).getByText("300 x 150 cm")).toBeVisible();
    expect(within(sizePicker).getByText("From NZ$359.99")).toBeVisible();
    expect(within(sizePicker).getByText("From NZ$489.99")).toBeVisible();

    const artworkPreview = screen.getByRole("region", { name: "Artwork preview" });
    expect(within(artworkPreview).getByText(
      "Roll Up Banner + 200 x 100 cm Wall Banner",
    )).toBeVisible();
    expect(within(artworkPreview).queryByText(/85 × 200 cm Roll-Up/))
      .not.toBeInTheDocument();

    const orderSummary = screen.getByRole("complementary", { name: "Order summary" });
    expect(within(orderSummary).getByText(
      "Roll Up Banner + 200 x 100 cm Wall Banner",
    )).toBeVisible();
    expect(within(orderSummary).getByText("NZ$359.99 incl GST")).toBeInTheDocument();
  });

  it("hides delivery choices and stores post for Australian bundle orders", () => {
    render(
      <BannerBundleConfigurator
        product={product}
        schema={schema}
        registry={enabledAustraliaRegistry()}
        market="AU"
        orderDate="2026-08-17"
        createId={() => "aud-bundle-item"}
      />,
    );

    expect(screen.queryByRole("radiogroup", { name: "Delivery" })).not.toBeInTheDocument();
    expect(screen.queryByText("Pickup")).not.toBeInTheDocument();
    expect(screen.queryByText(/New Zealand: 2–3 business days/i)).not.toBeInTheDocument();
    expect(screen.getByText(/DHL Express.*around 2 days/i)).toBeVisible();
    expect(screen.getByText(/Standard delivery.*7–10 days/i)).toBeVisible();
    expect(screen.getByText(/remote areas.*around two weeks/i)).toBeVisible();

    fireEvent.click(screen.getAllByText("Send Photos After Ordering")[0]);
    fireEvent.click(screen.getAllByText("Send Photos After Ordering")[1]);
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));

    const stored = JSON.parse(localStorage.getItem("rnr:commerce:v1:guest:cart")!);
    expect(stored.items[0].deliveryPreference).toBe("post");
  });

  it("shows the fixed five-photo component allowance even if an untrusted schema differs", () => {
    render(
      <BannerBundleConfigurator
        product={product}
        schema={{ ...schema, includedPhotos: 6 }}
        registry={defaultProductRegistry}
        pricing={defaultProductRegistry.pricing}
        orderDate="2026-08-17"
      />,
    );

    expect(screen.getAllByText(
      "Up to 5 photos are included. Additional photos are charged from photo 6.",
    )).toHaveLength(2);
    expect(screen.queryByText(
      "Up to 6 photos are included. Additional photos are charged from photo 7.",
    )).not.toBeInTheDocument();
  });

  it("adds one Bundle cart item with the active frozen union and grouped snapshots", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url, init?: RequestInit) => {
      const file = (init?.body as FormData).get("file") as File;
      return {
        ok: true,
        json: async () => ({
          reference: { id: `${file.name}-reference`, originalName: file.name },
        }),
      };
    }));
    render(
      <BannerBundleConfigurator
        product={product}
        schema={schema}
        registry={defaultProductRegistry}
        pricing={defaultProductRegistry.pricing}
        orderDate="2026-08-17"
        createId={() => "bundle-item"}
      />,
    );

    fireEvent.change(screen.getByLabelText("Roll-Up Banner customisation: Choose files"), {
      target: {
        files: [
          new File(["one"], "roll-one.jpg", { type: "image/jpeg" }),
          new File(["two"], "roll-two.jpg", { type: "image/jpeg" }),
        ],
      },
    });
    const rollUp = screen.getByRole("region", { name: "Roll-Up Banner customisation" });
    await within(rollUp).findByText("Photo 2");
    fireEvent.click(screen.getByRole("button", {
      name: "Roll-Up Banner customisation: Toggle background removal for Photo 2",
    }));
    fireEvent.change(
      screen.getByLabelText("Roll-Up Banner customisation: Text for your design"),
      { target: { value: "Roll-Up wording" } },
    );
    fireEvent.change(
      screen.getByLabelText("Roll-Up Banner customisation: Design notes"),
      { target: { value: "Roll-Up instructions" } },
    );

    const wallBanner = screen.getByRole("region", { name: "Wall Banner customisation" });
    fireEvent.click(within(wallBanner).getByText("Send Photos After Ordering"));
    fireEvent.change(
      screen.getByLabelText("Wall Banner customisation: Text for your design"),
      { target: { value: "Wall wording" } },
    );
    fireEvent.change(
      screen.getByLabelText("Wall Banner customisation: Design notes"),
      { target: { value: "Wall instructions" } },
    );

    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));

    const stored = JSON.parse(localStorage.getItem("rnr:commerce:v1:guest:cart")!);
    expect(stored.items).toHaveLength(1);
    expect(stored.items[0].sizeLabel)
      .toBe("85 × 200 cm Roll-Up + 200 × 100 cm Wall Banner");
    expect(stored.items[0]).toMatchObject({
      id: "bundle-item",
      productKey: "banner-bundle",
      photoSubmissionMethod: "upload",
      uploadReferences: ["roll-one.jpg-reference", "roll-two.jpg-reference"],
      bundleComponents: [
        {
          componentKey: "roll-up",
          photoSubmissionMethod: "upload",
          designText: "Roll-Up wording",
          notes: "Roll-Up instructions",
          uploadReferences: ["roll-one.jpg-reference", "roll-two.jpg-reference"],
          mainPhotoUploadId: "roll-one.jpg-reference",
          extraBackgroundRemovalUploadIds: ["roll-two.jpg-reference"],
        },
        {
          componentKey: "wall-banner",
          photoSubmissionMethod: "later",
          designText: "Wall wording",
          notes: "Wall instructions",
          uploadReferences: [],
        },
      ],
    });
    const event = analytics.emitAnalyticsEvent.mock.calls
      .map(([candidate]) => candidate)
      .find((candidate) => (candidate as { event?: string }).event === "add_to_cart");
    expect(event).toMatchObject({
      event: "add_to_cart",
      currency: "NZD",
      items: [{ item_id: "banner-bundle", item_variant: "rollup-wall-200x100" }],
    });
    const payload = JSON.stringify(event);
    expect(payload).not.toContain("bundleComponents");
    expect(payload).not.toContain("Roll-Up wording");
    expect(payload).not.toContain("Roll-Up instructions");
    expect(payload).not.toContain("Wall wording");
    expect(payload).not.toContain("Wall instructions");
    expect(payload).not.toContain("roll-one.jpg");
    expect(payload).not.toContain("roll-one.jpg-reference");
  });

  it("keeps the persisted Bundle and success UI when analytics throws", () => {
    analytics.emitAnalyticsEvent.mockImplementation(() => {
      throw new Error("analytics unavailable");
    });
    render(
      <BannerBundleConfigurator
        product={product}
        schema={schema}
        registry={defaultProductRegistry}
        pricing={defaultProductRegistry.pricing}
        orderDate="2026-08-17"
        createId={() => "fail-open-bundle"}
      />,
    );

    fireEvent.click(within(screen.getByRole("region", {
      name: "Roll-Up Banner customisation",
    })).getByText("Send Photos After Ordering"));
    fireEvent.click(within(screen.getByRole("region", {
      name: "Wall Banner customisation",
    })).getByText("Send Photos After Ordering"));
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));

    expect(JSON.parse(localStorage.getItem("rnr:commerce:v1:guest:cart")!).items)
      .toEqual([expect.objectContaining({ id: "fail-open-bundle" })]);
    expect(screen.getByRole("link", { name: "View cart" })).toBeVisible();
  });

  it("omits inactive references without deleting files retained in that group", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        reference: { id: "wall-reference", originalName: "wall.jpg" },
      }),
    }));
    render(
      <BannerBundleConfigurator
        product={product}
        schema={schema}
        registry={defaultProductRegistry}
        pricing={defaultProductRegistry.pricing}
        orderDate="2026-08-17"
        createId={() => "bundle-item"}
      />,
    );

    const rollUp = screen.getByRole("region", { name: "Roll-Up Banner customisation" });
    fireEvent.click(within(rollUp).getByText("Send Photos After Ordering"));
    fireEvent.change(screen.getByLabelText("Wall Banner customisation: Choose files"), {
      target: { files: [new File(["wall"], "wall.jpg", { type: "image/jpeg" })] },
    });
    const wallBanner = screen.getByRole("region", { name: "Wall Banner customisation" });
    expect(await screen.findByRole("button", {
      name: "Wall Banner customisation: Remove Photo 1",
    }))
      .toBeVisible();
    fireEvent.click(within(wallBanner).getByText("Send Photos After Ordering"));
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));

    const stored = JSON.parse(localStorage.getItem("rnr:commerce:v1:guest:cart")!).items[0];
    expect(stored.uploadReferences).toEqual([]);
    expect(stored.bundleComponents[1]).toMatchObject({
      componentKey: "wall-banner",
      photoSubmissionMethod: "later",
      uploadReferences: [],
    });

    fireEvent.click(within(wallBanner).getByText("Upload Photos Now"));
    expect(screen.getByRole("button", {
      name: "Wall Banner customisation: Remove Photo 1",
    }))
      .toBeVisible();
  });

  it("keeps the latest method and wording when an earlier upload resolves", async () => {
    let resolveUpload: ((response: {
      ok: boolean;
      json: () => Promise<{ reference: { id: string; originalName: string } }>;
    }) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, init?: RequestInit) => {
      const file = (init?.body as FormData).get("file") as File;
      if (file.name === "wall.jpg") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            reference: { id: "wall-reference", originalName: file.name },
          }),
        });
      }
      return new Promise((resolve) => {
        resolveUpload = resolve;
      });
    }));
    render(
      <BannerBundleConfigurator
        product={product}
        schema={schema}
        registry={defaultProductRegistry}
        pricing={defaultProductRegistry.pricing}
        orderDate="2026-08-17"
        createId={() => "latest-value-bundle"}
      />,
    );

    const rollUp = screen.getByRole("region", { name: "Roll-Up Banner customisation" });
    fireEvent.change(screen.getByLabelText("Wall Banner customisation: Choose files"), {
      target: { files: [new File(["wall"], "wall.jpg", { type: "image/jpeg" })] },
    });
    expect(await screen.findByRole("button", {
      name: "Wall Banner customisation: Remove Photo 1",
    })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Roll-Up Banner customisation: Choose files"), {
      target: { files: [new File(["roll"], "roll.jpg", { type: "image/jpeg" })] },
    });
    fireEvent.click(within(rollUp).getByText("Send Photos After Ordering"));
    fireEvent.change(
      screen.getByLabelText("Roll-Up Banner customisation: Text for your design"),
      { target: { value: "Latest Roll-Up wording" } },
    );

    await act(async () => resolveUpload?.({
      ok: true,
      json: async () => ({
        reference: { id: "deferred-roll-reference", originalName: "roll.jpg" },
      }),
    }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add to cart" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));

    const stored = JSON.parse(localStorage.getItem("rnr:commerce:v1:guest:cart")!).items[0];
    expect(stored.uploadReferences).toEqual(["wall-reference"]);
    expect(stored.bundleComponents[0]).toMatchObject({
      componentKey: "roll-up",
      photoSubmissionMethod: "later",
      designText: "Latest Roll-Up wording",
      uploadReferences: [],
    });
    expect(stored.bundleComponents[1]).toMatchObject({
      componentKey: "wall-banner",
      photoSubmissionMethod: "upload",
      uploadReferences: ["wall-reference"],
    });

    fireEvent.click(within(rollUp).getByText("Upload Photos Now"));
    expect(screen.getByRole("button", {
      name: "Roll-Up Banner customisation: Remove Photo 1",
    })).toBeVisible();
  });

  it("stacks each customisation group's upload previews at 390 px", () => {
    const css = readFileSync("src/components/storefront.module.css", "utf8");

    expect(css).toMatch(
      /@media \(max-width: 390px\)\s*\{[\s\S]*?\.bundleCustomisationGroup \.uploadPreviewGrid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/,
    );
  });
});
