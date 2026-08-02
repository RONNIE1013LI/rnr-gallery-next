import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfigurationSchema } from "@/domain/configuration/schemas";
import { getProductBySlug } from "@/domain/catalogue/products";
import { ProductConfigurator } from "./product-configurator";

const product = getProductBySlug("digital-oil-painting-canvas")!;
const schema = getConfigurationSchema(product.key)!;

describe("ProductConfigurator", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("shows the default configuration and exact price", () => {
    render(
      <ProductConfigurator
        product={product}
        schema={schema}
        createId={() => "configured-item"}
      />,
    );

    expect(screen.getByLabelText("Size")).toHaveValue("a4");
    expect(screen.getByLabelText("Landscape")).toBeChecked();
    expect(screen.getByLabelText("People or pets in artwork")).toHaveValue("1");
    expect(screen.getByText("$105.00")).toBeInTheDocument();
    expect(screen.getByText("$15.75")).toBeInTheDocument();
    expect(screen.getByText("$120.75")).toBeInTheDocument();
  });

  it("updates the quote and persists the configured item", () => {
    render(
      <ProductConfigurator
        product={product}
        schema={schema}
        createId={() => "configured-item"}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Increase people or pets" }));
    expect(screen.getByText("$125.00")).toBeInTheDocument();
    expect(screen.getByText("$18.75")).toBeInTheDocument();
    expect(screen.getByText("$143.75")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Needed by"), {
      target: { value: "2026-08-20" },
    });
    fireEvent.click(screen.getByText("Send after ordering"));
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));

    const stored = JSON.parse(localStorage.getItem("rnr-cart-v1")!);
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
        createId={() => "configured-item"}
      />,
    );

    fireEvent.change(screen.getByLabelText("Choose source photos"), {
      target: { files: [new File([new Uint8Array([1, 2, 3])], "source.jpg", { type: "image/jpeg" })] },
    });

    expect(await screen.findByText("source.jpg")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));
    const stored = JSON.parse(localStorage.getItem("rnr-cart-v1")!);
    expect(stored.items[0].uploadReferences).toEqual(["private-reference"]);
  });
});
