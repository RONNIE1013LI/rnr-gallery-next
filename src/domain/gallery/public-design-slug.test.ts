import { describe, expect, it } from "vitest";
import {
  buildPublicDesignSlug,
  publicDesignIdPrefixFromSlug,
  publicDesignTitle,
} from "./public-design-slug";

describe("public design slugs", () => {
  it("keeps duplicate human titles unique with an immutable ID suffix", () => {
    const firstId = `a1b2c3d4${"a".repeat(56)}`;
    const secondId = `e5f6a7b8${"b".repeat(56)}`;

    expect(buildPublicDesignSlug("Black & Gold 40th Birthday Roll-Up", firstId))
      .toBe("black-and-gold-40th-birthday-roll-up-a1b2c3d4");
    expect(buildPublicDesignSlug("Black & Gold 40th Birthday Roll-Up", secondId))
      .toBe("black-and-gold-40th-birthday-roll-up-e5f6a7b8");
  });

  it("normalises accents and falls back to design when a title has no latin words", () => {
    expect(buildPublicDesignSlug("Café — Family Canvas", `1234abcd${"c".repeat(56)}`))
      .toBe("cafe-family-canvas-1234abcd");
    expect(buildPublicDesignSlug("生日", `abcd1234${"d".repeat(56)}`))
      .toBe("design-abcd1234");
  });

  it("extracts only a valid eight-character hexadecimal lookup prefix", () => {
    expect(publicDesignIdPrefixFromSlug("birthday-banner-a1b2c3d4")).toBe("a1b2c3d4");
    expect(publicDesignIdPrefixFromSlug("birthday-banner-not-an-id")).toBeNull();
    expect(publicDesignIdPrefixFromSlug("a1b2c3d4")).toBeNull();
  });

  it("prefers a specific sub-occasion and otherwise uses accessible alt text", () => {
    expect(publicDesignTitle({ subOccasion: "21st Birthday", altText: "Gold birthday canvas" }))
      .toBe("21st Birthday");
    expect(publicDesignTitle({ subOccasion: null, altText: "Family portrait canvas" }))
      .toBe("Family portrait canvas");
  });
});
