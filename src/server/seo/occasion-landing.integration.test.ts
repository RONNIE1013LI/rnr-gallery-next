import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { galleryDesigns } from "@/server/db/schema";
import { isDedicatedTestDatabase } from "@/server/db/test-database-safety";
import { createDrizzleGalleryRepository } from "@/server/gallery/drizzle-gallery-repository";
import { createPublicGalleryService } from "@/server/gallery/public-gallery-service";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import { occasionLandingPages } from "@/domain/seo/occasion-landing-pages";
import { loadOccasionArtwork } from "./occasion-landing";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");
const database = drizzle(url);
const repository = createDrizzleGalleryRepository(database);
const row = {
  id: "1".repeat(64), productTypeSlug: "roll-up-banner" as const, productSlug: "roll-up-banner" as const,
  occasionSlug: "birthday" as const, subOccasion: "1st Birthday", themeSlugs: [], altText: "First birthday banner",
  storageKey: `generations/${"2".repeat(64)}/first.jpg`, contentHash: "3".repeat(64), mimeType: "image/jpeg" as const, width: 850, height: 2000,
};

describe.runIf(isDedicatedTestDatabase(url, process.env.DATABASE_URL))("occasion public artwork admission", () => {
  beforeEach(async () => { await database.delete(galleryDesigns); });
  afterAll(async () => { await database.delete(galleryDesigns); });
  it("excludes trashed, wrong-age and unavailable designs through the real public query", async () => {
    await database.insert(galleryDesigns).values([
      row,
      { ...row, id: "4".repeat(64), contentHash: "4".repeat(64), storageKey: `generations/${"2".repeat(64)}/trashed.jpg`, status: "trashed", trashedAt: new Date() },
      { ...row, id: "5".repeat(64), contentHash: "5".repeat(64), storageKey: `generations/${"2".repeat(64)}/wrong-age.jpg`, subOccasion: "21st Birthday" },
      { ...row, id: "6".repeat(64), contentHash: "6".repeat(64), storageKey: `generations/${"2".repeat(64)}/missing.jpg` },
    ]);
    const service = createPublicGalleryService({ repository, imageAvailable: async (key) => !key.endsWith("missing.jpg") });
    const result = await loadOccasionArtwork(occasionLandingPages["1st-birthday-banners"], defaultProductRegistry, service);
    expect(result.map((item) => item.id)).toEqual([row.id]);
  });
});
