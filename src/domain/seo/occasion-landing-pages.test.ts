import { describe, expect, it } from "vitest";
import { occasionLandingPages, selectOccasionArtwork } from "./occasion-landing-pages";
import type { PublicGalleryItem } from "@/server/gallery/public-gallery-service";

const artwork = (overrides: Partial<PublicGalleryItem> = {}): PublicGalleryItem => ({
  id: "a".repeat(64), productTypeSlug: "roll-up-banner", productSlug: "roll-up-banner",
  occasionSlug: "birthday", subOccasion: "1st Birthday", themeSlugs: [],
  altText: "First birthday banner", contentHash: "b".repeat(64), mimeType: "image/jpeg",
  width: 850, height: 2000, ...overrides,
});

describe("occasion landing artwork selection", () => {
  it("limits route ownership to the six requested intents", () => {
    expect(Object.keys(occasionLandingPages)).toEqual([
      "birthday-banners", "1st-birthday-banners", "21st-birthday-banners",
      "memorial-banners", "graduation-banners", "polynesian-banners",
    ]);
  });
  it.each(["1st-birthday-banners", "21st-birthday-banners"] as const)("uses exact structured birthday age for %s", (slug) => {
    const age = slug.startsWith("1st") ? "1st Birthday" : "21st Birthday";
    const yes = artwork({ subOccasion: age });
    const no = [
      artwork({ id: "c".repeat(64), subOccasion: "21 years together", occasionSlug: "wedding", altText: age }),
      artwork({ id: "d".repeat(64), subOccasion: null, altText: age }),
      artwork({ id: "e".repeat(64), subOccasion: "18th Birthday" }),
      artwork({ id: "f".repeat(64), subOccasion: age, productTypeSlug: "canvas", productSlug: "custom-themed-canvas" }),
    ];
    expect(selectOccasionArtwork(occasionLandingPages[slug], [yes, ...no])).toEqual([yes]);
  });
  it.each([['memorial-banners', 'memorial'], ['graduation-banners', 'graduation']] as const)("requires the real occasion for %s", (slug, occasionSlug) => {
    const yes = artwork({ occasionSlug, subOccasion: null });
    expect(selectOccasionArtwork(occasionLandingPages[slug], [artwork({ altText: occasionSlug }), yes])).toEqual([yes]);
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
      subOccasion: i < 20 ? "1st Birthday" : ["18th Birthday", "21st Birthday", "40th Birthday", "50th Birthday"][i - 20],
    }));
    const selected = selectOccasionArtwork(occasionLandingPages['birthday-banners'], rows);
    expect(selected).toHaveLength(18);
    expect(new Set(selected.slice(0, 3).map((x) => x.subOccasion)).size).toBe(3);
    expect(selectOccasionArtwork(occasionLandingPages['birthday-banners'], rows)).toEqual(selected);
  });
});
