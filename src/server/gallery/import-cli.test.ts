import { describe, expect, it } from "vitest";
import { parseGalleryImportArguments } from "./import-cli";

describe("parseGalleryImportArguments", () => {
  it("requires exactly one manifest, image directory, and report path", () => {
    expect(
      parseGalleryImportArguments([
        "--manifest", "/source/manifest.json",
        "--images", "/source/images",
        "--report", "/reports/import.json",
      ]),
    ).toEqual({
      manifestPath: "/source/manifest.json",
      imagesDir: "/source/images",
      reportPath: "/reports/import.json",
    });
    expect(() => parseGalleryImportArguments(["--manifest", "/only.json"]))
      .toThrow(/--images is required/i);
    expect(() => parseGalleryImportArguments([
      "--manifest", "/a", "--images", "/b", "--report", "/c", "--bad", "x",
    ])).toThrow(/unknown argument/i);
  });
});
