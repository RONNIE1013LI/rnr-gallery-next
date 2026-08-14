import { describe, expect, it } from "vitest";
import { formatConfigurationSizeLabel } from "./size-label";

describe("formatConfigurationSizeLabel", () => {
  const size = {
    key: "a4",
    label: "A4 — 29.7 × 21 cm",
    priceExGstCents: 6_500,
  };

  it("shows chosen canvas orientation as width × height", () => {
    expect(formatConfigurationSizeLabel(size, "landscape")).toBe(
      "A4 — 29.7 × 21 cm",
    );
    expect(formatConfigurationSizeLabel(size, "portrait")).toBe(
      "A4 — 21 × 29.7 cm",
    );
  });

  it("leaves a fixed product label unchanged", () => {
    expect(formatConfigurationSizeLabel({
      label: "85 × 200 cm",
    })).toBe("85 × 200 cm");
  });
});
