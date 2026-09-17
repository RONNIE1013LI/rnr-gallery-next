import { describe, expect, it } from "vitest";
import {
  galleryPageHref,
  parseGalleryQuery,
} from "./query";

describe("parseGalleryQuery", () => {
  it("preserves an approved product filter across gallery pages", () => {
    const query = parseGalleryQuery({ product: "digital-oil-painting-banner" });
    expect(query).toMatchObject({ productSlug: "digital-oil-painting-banner" });
    expect(galleryPageHref(query, 2)).toContain("product=digital-oil-painting-banner");
    expect(parseGalleryQuery({ product: "invalid-product" })).not.toHaveProperty("productSlug");
  });

  it("normalises legacy filters and accepts the expanded public taxonomy", () => {
    expect(parseGalleryQuery({
      page: "-2",
      occasion: ["birthday", "anniversary", "religious", "bad", "birthday"],
      design_type: ["canvas", "unknown"],
      theme: ["cultural-island", "bad"],
      birthday_age: ["21st Birthday", "10th-birthday", "999th Birthday"],
    })).toEqual({
      page: 1,
      productTypes: ["canvas"],
      occasions: ["birthday", "anniversary", "religious-church"],
      birthdayAges: ["21st-birthday", "10th-birthday"],
      themes: ["cultural-island"],
    });
  });

  it("accepts URLSearchParams and ignores unrelated keys", () => {
    const params = new URLSearchParams();
    params.append("occasion", "memorial");
    params.append("occasion", "welcome-home");
    params.set("page", "3");
    params.set("redirect", "https://attacker.example");

    expect(parseGalleryQuery(params)).toEqual({
      page: 3,
      productTypes: [],
      occasions: ["memorial", "welcome-home"],
      birthdayAges: [],
      themes: [],
    });
  });
});

describe("galleryPageHref", () => {
  it("preserves active public filters while changing only the page", () => {
    expect(galleryPageHref({
      page: 1,
      productTypes: ["canvas"],
      occasions: ["birthday", "memorial"],
      birthdayAges: ["21st-birthday"],
      themes: [],
    }, 2)).toBe(
      "/design-gallery?design_type=canvas&occasion=birthday&occasion=memorial&birthday_age=21st-birthday&page=2",
    );
  });
});
