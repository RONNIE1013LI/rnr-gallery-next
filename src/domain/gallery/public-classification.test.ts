import { describe, expect, it } from "vitest";
import {
  getPublicDesignClassification,
  publicClassificationStats,
} from "./public-classification";

describe("public Gallery classification overlay", () => {
  it("freezes one classification record for every current live Design", () => {
    expect(publicClassificationStats).toEqual({
      records: 357,
      indexable: 350,
      hidden: 7,
      canonicalDuplicates: 6,
    });
  });

  it("preserves current public slugs while correcting reviewed taxonomy", () => {
    expect(getPublicDesignClassification(
      "88e63ad4c403d5bcdb37f2ee2f142d63100c970b43808f82f5b6ca21a1aea5aa",
    )).toMatchObject({
      publicSlug: "5th-birthday-88e63ad4",
      occasionSlug: "birthday",
      subOccasion: "5th-birthday",
      seoIndex: true,
      hiddenFromListings: false,
    });

    expect(getPublicDesignClassification(
      "ddd53b2fa128d66cfc1a4ea69e2371823f2c0bd0b440a8e6b4eaea35740fa8c6",
    )).toMatchObject({
      occasionSlug: "birthday",
      subOccasion: "5th-birthday",
      seoIndex: false,
      hiddenFromListings: true,
      canonicalPublicSlug: "5th-birthday-88e63ad4",
    });
  });

  it("keeps the reviewed broken artwork out of listings and the sitemap", () => {
    const broken = getPublicDesignClassification(
      "d670df82400b7a107ad9a1133bf5a0ac0484ba7b6da5d3408631e10457975206",
    );
    expect(broken).toMatchObject({
      subOccasion: "broken-image",
      seoIndex: false,
      hiddenFromListings: true,
      canonicalDesignId: null,
    });
  });
});
