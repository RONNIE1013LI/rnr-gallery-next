import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProductBySlug } from "@/domain/catalogue/products";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import { getConfigurationSchema } from "@/domain/configuration/schemas";
import { BannerBundleConfigurator } from "./banner-bundle-configurator";

const product = getProductBySlug("banner-bundle")!;
const schema = getConfigurationSchema(product.key)!;

describe("BannerBundleConfigurator", () => {
  beforeEach(() => localStorage.clear());
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

    expect(screen.getAllByRole("region", { name: "Artwork preview" })).toHaveLength(1);
    expect(screen.getAllByRole("complementary", { name: "Order summary" })).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Roll-Up Banner customisation" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Wall Banner customisation" })).toBeVisible();
    expect(document.querySelector("form#customise")).not.toBeNull();
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
