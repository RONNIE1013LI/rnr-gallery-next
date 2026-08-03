import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { galleryDesigns } from "@/server/db/schema";
import {
  createDrizzleGalleryRepository,
  GalleryImportConflictError,
} from "./drizzle-gallery-repository";
import type { GalleryImportRow } from "./gallery-repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
const testDatabaseName = new URL(testDatabaseUrl).pathname.replace(/^\//, "");
const hasDedicatedTestDatabase =
  testDatabaseUrl !== process.env.DATABASE_URL &&
  /(?:^|[-_])test(?:$|[-_])/.test(testDatabaseName);

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
});
