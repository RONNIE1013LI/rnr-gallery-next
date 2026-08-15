import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { galleryDesigns } from "@/server/db/schema";
import {
  createDrizzleGalleryRepository,
  GalleryImportConflictError,
} from "./drizzle-gallery-repository";
import type { GalleryImportRow } from "./gallery-repository";
import { isDedicatedTestDatabase } from "@/server/db/test-database-safety";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
const hasDedicatedTestDatabase = isDedicatedTestDatabase(
  testDatabaseUrl,
  process.env.DATABASE_URL,
);

const database = drizzle(testDatabaseUrl);
const repository = createDrizzleGalleryRepository(database);
const row: GalleryImportRow = {
  id: "1".repeat(64),
  productTypeSlug: "canvas",
  occasionSlug: "memorial",
  subOccasion: null,
  themeSlugs: ["religious-memorial"],
  altText: "Memorial canvas design",
  productSlug: "digital-oil-painting-canvas",
  storageKey: `generations/${"2".repeat(64)}/${"1".repeat(64)}-${"3".repeat(12)}.jpg`,
  contentHash: "3".repeat(64),
  mimeType: "image/jpeg",
  width: 1200,
  height: 1600,
};

describe.runIf(hasDedicatedTestDatabase)("createDrizzleGalleryRepository", () => {
  beforeEach(async () => {
    await database.delete(galleryDesigns);
  });

  afterAll(async () => {
    await database.delete(galleryDesigns);
  });

  it("inserts one initial snapshot and treats an identical rerun as a no-op", async () => {
    await expect(repository.replaceInitialImport([row])).resolves.toEqual({
      imported: 1,
      unchanged: 0,
    });
    await expect(repository.replaceInitialImport([row])).resolves.toEqual({
      imported: 0,
      unchanged: 1,
    });
  });

  it("rejects a different snapshot without changing the stored row", async () => {
    await repository.replaceInitialImport([row]);

    await expect(
      repository.replaceInitialImport([{ ...row, altText: "Changed" }]),
    ).rejects.toBeInstanceOf(GalleryImportConflictError);

    const stored = await database.select().from(galleryDesigns);
    expect(stored).toHaveLength(1);
    expect(stored[0].altText).toBe("Memorial canvas design");
  });

  it("filters and paginates active designs in PostgreSQL", async () => {
    const matching = {
      ...row,
      id: "4".repeat(64),
      contentHash: "4".repeat(64),
      storageKey: `generations/${"2".repeat(64)}/${"4".repeat(64)}-${"4".repeat(12)}.jpg`,
      occasionSlug: "birthday" as const,
      subOccasion: "21st Birthday",
      themeSlugs: ["cultural-island" as const],
      altText: "Matching canvas",
    };
    const wrongProduct = {
      ...matching,
      id: "5".repeat(64),
      contentHash: "5".repeat(64),
      storageKey: `generations/${"2".repeat(64)}/${"5".repeat(64)}-${"5".repeat(12)}.jpg`,
      productTypeSlug: "roll-up-banner" as const,
      productSlug: "roll-up-banner" as const,
      altText: "Wrong product",
    };
    await database.insert(galleryDesigns).values([matching, wrongProduct]);

    await expect(repository.listActivePage({
      page: 9,
      productTypes: ["canvas"],
      occasions: ["birthday"],
      birthdayAges: ["21st Birthday"],
      themes: ["cultural-island"],
    }, 24)).resolves.toMatchObject({
      total: 1,
      page: 1,
      pageCount: 1,
      items: [expect.objectContaining({ id: matching.id })],
    });
  });

  it("resolves only a unique active design ID prefix", async () => {
    const first = {
      ...row,
      id: `abcdef12${"1".repeat(56)}`,
      contentHash: "6".repeat(64),
      storageKey: `generations/${"2".repeat(64)}/abcdef12-${"6".repeat(12)}.jpg`,
    };
    const collision = {
      ...row,
      id: `abcdef12${"2".repeat(56)}`,
      contentHash: "7".repeat(64),
      storageKey: `generations/${"2".repeat(64)}/abcdef12-${"7".repeat(12)}.jpg`,
    };
    await database.insert(galleryDesigns).values(first);

    await expect(repository.findActiveDesignByIdPrefix!("abcdef12"))
      .resolves.toMatchObject({ id: first.id });

    await database.insert(galleryDesigns).values(collision);
    await expect(repository.findActiveDesignByIdPrefix!("abcdef12")).resolves.toBeNull();
  });
});
