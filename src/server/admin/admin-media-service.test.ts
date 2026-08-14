import { describe, expect, it } from "vitest";
import { attachProductMediaUsage } from "./admin-media-service";

describe("admin media inventory", () => {
  it("shows product usage and reports published image references that are missing", () => {
    const canvas = {
      name: "home/canvas.webp",
      url: "/media/home/canvas.webp",
      sizeBytes: 10,
      modifiedAt: new Date("2026-08-05T00:00:00.000Z"),
    };

    expect(attachProductMediaUsage([canvas], [
      { title: "Canvas", image: { src: "/media/home/canvas.webp" } },
      { title: "Banner", image: { src: "/media/home/missing.webp" } },
    ])).toEqual({
      storefront: [{ ...canvas, usedBy: ["Canvas"] }],
      missingProductMedia: [{ title: "Banner", imageSrc: "/media/home/missing.webp" }],
    });
  });
});
