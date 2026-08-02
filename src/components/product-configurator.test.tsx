import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { getConfigurationSchema } from "@/domain/configuration/schemas";
import { getProductBySlug } from "@/domain/catalogue/products";
import { ProductConfigurator } from "./product-configurator";

const product = getProductBySlug("digital-oil-painting-canvas")!;
const schema = getConfigurationSchema(product.key)!;

describe("ProductConfigurator", () => {
  beforeEach(() => localStorage.clear());

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
    fireEvent.click(screen.getAllByRole("button", { name: "Add to cart" })[1]);

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
});
