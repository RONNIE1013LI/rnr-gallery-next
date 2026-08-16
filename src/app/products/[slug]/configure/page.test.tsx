import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getProductBySlug } from "@/domain/catalogue/products";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import { getConfigurationSchema } from "@/domain/configuration/schemas";
import { ConfigurePageContent } from "./page-content";

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
});
