import { describe, expect, it } from "vitest";
import {
  galleryPageHref,
  parseGalleryQuery,
} from "./query";

describe("parseGalleryQuery", () => {
  it("keeps only approved repeated filters and clamps invalid pages", () => {
    expect(parseGalleryQuery({
      page: "-2",
      occasion: ["birthday", "bad", "birthday"],
      design_type: ["canvas", "unknown"],
      theme: ["cultural-island", "bad"],
      birthday_age: ["21st Birthday", "999th Birthday"],
    })).toEqual({
      page: 1,
      productTypes: ["canvas"],
      occasions: ["birthday"],
      birthdayAges: ["21st Birthday"],
      themes: ["cultural-island"],
    });
  });

  it("accepts URLSearchParams and ignores unrelated keys", () => {
    const params = new URLSearchParams();
    params.append("occasion", "memorial");
    params.append("occasion", "religious");
    params.set("page", "3");
    params.set("redirect", "https://attacker.example");

    expect(parseGalleryQuery(params)).toEqual({
      page: 3,
      productTypes: [],
      occasions: ["memorial", "religious"],
      birthdayAges: [],
      themes: [],
    });
  });
});

describe("galleryPageHref", () => {
  it("preserves active filters while changing only the page", () => {
    expect(galleryPageHref({
      page: 1,
      productTypes: ["canvas"],
      occasions: ["birthday", "memorial"],
      birthdayAges: ["21st Birthday"],
      themes: [],
    }, 2)).toBe(
      "/design-gallery?design_type=canvas&occasion=birthday&occasion=memorial&birthday_age=21st+Birthday&page=2",
    );
  });
});
