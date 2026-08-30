import { describe, expect, it } from "vitest";
import { classifyWebsiteAttribution } from "./website-attribution";

const emptyLanding = {
  advertisingConsent: false,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  referrerOrigin: null,
  clickIdTypes: [],
} as const;

describe("classifyWebsiteAttribution", () => {
  it.each(["gclid", "gbraid", "wbraid"] as const)(
    "classifies consented %s traffic as Google Ads",
    (clickIdType) => {
      expect(classifyWebsiteAttribution({
        ...emptyLanding,
        advertisingConsent: true,
        clickIdTypes: [clickIdType],
      })).toEqual({
        channel: "google_ads",
        source: "google",
        medium: "paid_click",
        utmCampaign: null,
        clickIdType,
      });
    },
  );

  it("classifies consented fbclid traffic as Meta Ads", () => {
    expect(classifyWebsiteAttribution({
      ...emptyLanding,
      advertisingConsent: true,
      clickIdTypes: ["fbclid"],
    })).toEqual({
      channel: "meta_ads",
      source: "meta",
      medium: "paid_click",
      utmCampaign: null,
      clickIdType: "fbclid",
    });
  });

  it("never uses click IDs without advertising consent", () => {
    expect(classifyWebsiteAttribution({
      ...emptyLanding,
      clickIdTypes: ["gclid"],
    }).channel).toBe("direct");
  });

  it("fails conflicting Google and Meta click evidence into Other", () => {
    expect(classifyWebsiteAttribution({
      ...emptyLanding,
      advertisingConsent: true,
      clickIdTypes: ["gclid", "fbclid"],
    })).toEqual({
      channel: "other",
      source: "conflicting_paid_signals",
      medium: null,
      utmCampaign: null,
      clickIdType: null,
    });
  });

  it.each([
    ["google", "cpc", "google_ads"],
    ["Google Ads", "paid_search", "google_ads"],
    ["facebook", "paid_social", "meta_ads"],
    ["instagram", "cpc", "meta_ads"],
    ["meta", "ppc", "meta_ads"],
  ] as const)("classifies paid UTM %s/%s as %s", (source, medium, channel) => {
    expect(classifyWebsiteAttribution({
      ...emptyLanding,
      utmSource: source,
      utmMedium: medium,
      utmCampaign: "Spring Launch",
    })).toMatchObject({
      channel,
      utmCampaign: "Spring Launch",
      clickIdType: null,
    });
  });

  it("classifies a Google referrer as Google Organic", () => {
    expect(classifyWebsiteAttribution({
      ...emptyLanding,
      referrerOrigin: "https://www.google.co.nz",
    }).channel).toBe("google_organic");
  });

  it("does not trust a lookalike Google referrer", () => {
    expect(classifyWebsiteAttribution({
      ...emptyLanding,
      referrerOrigin: "https://google.evil.com",
    })).toMatchObject({ channel: "other", source: "google.evil.com" });
  });

  it("classifies no landing evidence as Direct", () => {
    expect(classifyWebsiteAttribution(emptyLanding)).toEqual({
      channel: "direct",
      source: "direct",
      medium: null,
      utmCampaign: null,
      clickIdType: null,
    });
  });

  it.each([
    "https://rnrgallery.com",
    "https://www.rnrgallery.com",
    "https://rrgallery.co.nz",
    "https://www.rrgallery.co.nz",
  ])("classifies the store's own referrer %s as Direct", (referrerOrigin) => {
    expect(classifyWebsiteAttribution({
      ...emptyLanding,
      referrerOrigin,
    })).toEqual({
      channel: "direct",
      source: "direct",
      medium: null,
      utmCampaign: null,
      clickIdType: null,
    });
  });

  it("does not erase explicit campaign evidence just because the referrer is the store", () => {
    expect(classifyWebsiteAttribution({
      ...emptyLanding,
      utmCampaign: "Spring",
      referrerOrigin: "https://rnrgallery.com",
    })).toMatchObject({
      channel: "other",
      source: "rnrgallery.com",
      utmCampaign: "Spring",
    });
  });

  it("preserves a consented Google click across the legacy-domain redirect", () => {
    expect(classifyWebsiteAttribution({
      ...emptyLanding,
      advertisingConsent: true,
      clickIdTypes: ["gclid"],
      referrerOrigin: "https://rrgallery.co.nz",
    })).toMatchObject({ channel: "google_ads", source: "google", clickIdType: "gclid" });
  });

  it("classifies non-core referrers as Other", () => {
    expect(classifyWebsiteAttribution({
      ...emptyLanding,
      referrerOrigin: "https://www.facebook.com",
    })).toMatchObject({ channel: "other", source: "facebook.com" });
  });

  it("bounds and normalizes stored attribution values", () => {
    expect(classifyWebsiteAttribution({
      ...emptyLanding,
      utmSource: `  ${"A".repeat(300)}  `,
      utmMedium: "  Newsletter  ",
      utmCampaign: `  ${"C".repeat(120)}  `,
    })).toEqual({
      channel: "other",
      source: "a".repeat(255),
      medium: "newsletter",
      utmCampaign: "C".repeat(100),
      clickIdType: null,
    });
  });
});
