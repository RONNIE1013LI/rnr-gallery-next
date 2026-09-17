import { describe, expect, it } from "vitest";
import { occasionLandingPages, selectOccasionArtwork } from "./occasion-landing-pages";
import type { PublicGalleryItem } from "@/server/gallery/public-gallery-service";

const artwork = (overrides: Partial<PublicGalleryItem> = {}): PublicGalleryItem => ({
  id: "a".repeat(64), productTypeSlug: "roll-up-banner", productSlug: "roll-up-banner",
  occasionSlug: "birthday", subOccasion: "1st-birthday", themeSlugs: [],
  altText: "First birthday banner", contentHash: "b".repeat(64), mimeType: "image/jpeg",
  width: 850, height: 2000,
  publicSlug: "1st-birthday-aaaaaaaa", displayTitle: "1st Birthday", seoTitle: "1st Birthday Roll-Up Banner Design",
  seoDescription: "First birthday roll-up banner design.", intro: "A first birthday roll-up banner design.",
  secondaryOccasions: [], palette: [], seoIndex: true, hiddenFromListings: false, canonicalDesignId: null, canonicalPublicSlug: null,
  ...overrides,
});

describe("occasion landing artwork selection", () => {
  it("limits route ownership to the six requested intents", () => {
    expect(Object.keys(occasionLandingPages)).toEqual([
      "birthday-banners", "1st-birthday-banners", "21st-birthday-banners",
      "memorial-banners", "graduation-banners", "anniversary-designs",
      "welcome-home-banners", "polynesian-banners",
    ]);
  });
  it.each(["1st-birthday-banners", "21st-birthday-banners"] as const)("uses exact structured birthday age for %s", (slug) => {
    const age = slug.startsWith("1st") ? "1st-birthday" : "21st-birthday";
    const yes = artwork({ subOccasion: age });
    const no = [
      artwork({ id: "c".repeat(64), subOccasion: "21 years together", occasionSlug: "wedding", altText: age }),
      artwork({ id: "d".repeat(64), subOccasion: null, altText: age }),
      artwork({ id: "e".repeat(64), subOccasion: "18th-birthday" }),
      artwork({ id: "f".repeat(64), subOccasion: age, productTypeSlug: "canvas", productSlug: "custom-themed-canvas" }),
    ];
    expect(selectOccasionArtwork(occasionLandingPages[slug], [yes, ...no])).toEqual([yes]);
  });
  it.each([['memorial-banners', 'memorial'], ['graduation-banners', 'graduation']] as const)("requires the real occasion for %s", (slug, occasionSlug) => {
    const yes = artwork({ occasionSlug, subOccasion: null });
    expect(selectOccasionArtwork(occasionLandingPages[slug], [artwork({ altText: occasionSlug }), yes])).toEqual([yes]);
  });
  it("keeps graduation copy accurate when no verified graduation artwork is published", () => {
    const content = occasionLandingPages["graduation-banners"];
    expect(content.description).toMatch(/does not currently include a verified graduation example/i);
    expect(content.artworkNote).toMatch(/no verified graduation examples/i);
  });
  it("owns dedicated pages only where the reviewed taxonomy has enough real examples", () => {
    expect(occasionLandingPages["anniversary-designs"].query.occasions).toEqual(["anniversary"]);
    expect(occasionLandingPages["welcome-home-banners"].query.occasions).toEqual(["welcome-home"]);
  });
  it("uses only Cultural / Island metadata without inferring an ethnic identity from names", () => {
    const cultural = artwork({ themeSlugs: ["cultural-island"], altText: "Customer cultural references" });
    const namedOnly = artwork({ id: "c".repeat(64), altText: "Samoan Tongan Polynesian banner" });
    expect(selectOccasionArtwork(occasionLandingPages['polynesian-banners'], [cultural, namedOnly])).toEqual([cultural]);
    expect(occasionLandingPages['polynesian-banners'].artworkNote).toMatch(/identit/i);
  });
  it("keeps a stable varied first row instead of repeating one birthday age", () => {
    const rows = Array.from({ length: 24 }, (_, i) => artwork({
      id: i.toString(16).padStart(64, '0'),
      subOccasion: i < 20 ? "1st-birthday" : ["18th-birthday", "21st-birthday", "40th-birthday", "50th-birthday"][i - 20],
    }));
    const selected = selectOccasionArtwork(occasionLandingPages['birthday-banners'], rows);
    expect(selected).toHaveLength(18);
    expect(new Set(selected.slice(0, 3).map((x) => x.subOccasion)).size).toBe(3);
    expect(selectOccasionArtwork(occasionLandingPages['birthday-banners'], rows)).toEqual(selected);
  });
});
