import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as analytics from "@/domain/analytics/client";
import { getProductBySlug } from "@/domain/catalogue/products";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import { getConfigurationSchema } from "@/domain/configuration/schemas";
import { ConfigurePageContent } from "./page-content";

vi.mock("@/domain/analytics/client", () => ({
  emitAnalyticsEvent: vi.fn(() => true),
}));

beforeEach(() => {
  vi.mocked(analytics.emitAnalyticsEvent).mockReset();
  vi.mocked(analytics.emitAnalyticsEvent).mockReturnValue(true);
});

describe("ConfigurePageContent", () => {
  it("opens directly into the customising form without a redundant introduction CTA", () => {
    const product = getProductBySlug("digital-oil-painting-canvas")!;
    const schema = getConfigurationSchema(product.key)!;
    render(<ConfigurePageContent
      product={product}
      schema={schema}
      pricing={defaultProductRegistry.pricing}
      orderDate="2026-08-16"
      selectedDesign={null}
      relatedDesigns={[]}
    />);

    expect(screen.queryByRole("link", { name: "Start Customising" }))
      .not.toBeInTheDocument();
    expect(document.querySelector("form#customise")).not.toBeNull();
    expect(screen.getByText("Upload Photos Now")).toBeVisible();
    expect(screen.getByText("Send Photos After Ordering")).toBeVisible();
  });

  it("dispatches only the Banner Bundle route to two customisation groups", () => {
    const product = getProductBySlug("banner-bundle")!;
    const schema = getConfigurationSchema(product.key)!;
    render(<ConfigurePageContent
      product={product}
      schema={schema}
      pricing={defaultProductRegistry.pricing}
      registry={defaultProductRegistry}
      orderDate="2026-08-17"
      selectedDesign={null}
      relatedDesigns={[]}
    />);

    expect(screen.getByRole("region", { name: "Roll-Up Banner customisation" }))
      .toBeVisible();
    expect(screen.getByRole("region", { name: "Wall Banner customisation" }))
      .toBeVisible();
    expect(screen.getAllByRole("complementary", { name: "Order summary" })).toHaveLength(1);
  });

  it("tracks view_item when a customer enters the direct configuration route", async () => {
    const product = getProductBySlug("photo-print-canvas")!;
    const schema = getConfigurationSchema(product.key)!;
    render(<ConfigurePageContent
      product={product}
      schema={schema}
      pricing={defaultProductRegistry.pricing}
      registry={defaultProductRegistry}
      orderDate="2026-08-17"
      selectedDesign={null}
      relatedDesigns={[]}
    />);

    await waitFor(() => expect(analytics.emitAnalyticsEvent).toHaveBeenCalledWith({
      event: "view_item",
      currency: "NZD",
      value: 65,
      items: [{
        item_id: "photo-print-canvas",
        item_name: "Photo Print Canvas",
        item_category: "canvas",
        item_variant: "a4",
        price: 65,
        quantity: 1,
      }],
    }));
  });
});
