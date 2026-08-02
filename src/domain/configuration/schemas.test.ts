import { describe, expect, it } from "vitest";
import { products } from "@/domain/catalogue/products";
import { configurationSchemas, getConfigurationSchema } from "./schemas";

describe("product configuration schemas", () => {
  it("defines one schema for every active product", () => {
    expect(configurationSchemas).toHaveLength(7);
    expect(configurationSchemas.map((schema) => schema.productKey).sort()).toEqual(
      products.map((product) => product.key).sort(),
    );
  });

  it("sets the approved Digital Oil Canvas defaults", () => {
    const schema = getConfigurationSchema("digital-oil-painting-canvas");

    expect(schema).toMatchObject({
      defaultSizeKey: "a4",
      orientationMode: "choice",
      defaultOrientation: "landscape",
      peoplePetsMode: "required",
      defaultPeoplePets: 1,
      defaultDeliveryPreference: "post",
    });
    expect(schema?.sizes.map((size) => size.key)).toEqual([
      "a4",
      "a3",
      "a2",
      "a1",
      "a0",
    ]);
  });

  it("keeps Roll-Up and Grave Cover fixed", () => {
    expect(getConfigurationSchema("roll-up-banner")).toMatchObject({
      defaultSizeKey: "standard",
      orientationMode: "none",
    });
    expect(getConfigurationSchema("grave-cover")).toMatchObject({
      defaultSizeKey: "standard",
      orientationMode: "fixed",
      defaultOrientation: "portrait",
    });
  });

  it("uses only post and pickup delivery choices with post first", () => {
    for (const schema of configurationSchemas) {
      expect(schema.deliveryPreferences).toEqual(["post", "pickup"]);
      expect(schema.defaultDeliveryPreference).toBe("post");
      expect(schema.sizes.length).toBeGreaterThan(0);
    }
  });
});
