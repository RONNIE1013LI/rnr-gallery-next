import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { galleryDesignRevisions, adminAuditLogs, user, galleryDesigns } from "@/server/db/schema";
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

  it("audits reclassification and restores the original design before rolling back constraints", async () => {
    const actorId = randomUUID();
    await database.insert(user).values({ id: actorId, name: "Gallery test", email: `${actorId}@example.test`, role: "admin" });
    const original = { ...row, productTypeSlug: "wall-hanging-banners" as const, productSlug: "custom-themed-wall-banner" as const };
    try {
      await database.insert(galleryDesigns).values(original);
      await repository.updateDesign(row.id, { productSlug: "digital-oil-painting-banner" }, actorId);
      const changed = await repository.findActiveDesign(row.id);
      expect(changed).toMatchObject({ ...original, productSlug: "digital-oil-painting-banner" });
      const revisions = await database.select().from(galleryDesignRevisions).where(eq(galleryDesignRevisions.designId, row.id));
      expect(revisions).toHaveLength(1);
      expect(revisions[0].priorSnapshot).toMatchObject({ productSlug: "custom-themed-wall-banner", contentHash: row.contentHash });
      await repository.updateDesign(row.id, { productSlug: original.productSlug }, actorId);
      expect(await repository.findActiveDesign(row.id)).toMatchObject(original);
      const audit = await database.select().from(adminAuditLogs).where(eq(adminAuditLogs.actorUserId, actorId));
      expect(audit).toHaveLength(2);
      const previous = JSON.parse(readFileSync("drizzle/meta/0063_snapshot.json", "utf8"));
      const rollbackProbe = new Error("rollback probe complete");
      await expect(database.transaction(async (transaction) => {
        for (const name of ["gallery_designs_product_slug_valid", "gallery_designs_product_mapping_valid"]) {
          await transaction.execute(sql.raw(`ALTER TABLE gallery_designs DROP CONSTRAINT ${name}`));
          await transaction.execute(sql.raw(`ALTER TABLE gallery_designs ADD CONSTRAINT ${name} CHECK (${previous.tables["public.gallery_designs"].checkConstraints[name].value})`));
        }
        throw rollbackProbe;
      })).rejects.toBe(rollbackProbe);
      await repository.updateDesign(row.id, { productSlug: "digital-oil-painting-banner" }, actorId);
    } finally {
      await database.delete(galleryDesignRevisions).where(eq(galleryDesignRevisions.designId, row.id));
      await database.delete(galleryDesigns).where(eq(galleryDesigns.id, row.id));
      await database.delete(adminAuditLogs).where(eq(adminAuditLogs.actorUserId, actorId));
      await database.delete(user).where(eq(user.id, actorId));
    }
  });

  it("paginates the selected banner product without mixing in themed banners", async () => {
    const designs = Array.from({ length: 27 }, (_, index) => {
      const id = (index + 10).toString(16).padStart(64, "0");
      return { ...row, id, contentHash: id, storageKey: `managed/${id}.jpg`, productTypeSlug: "wall-hanging-banners" as const,
        productSlug: index === 26 ? "custom-themed-wall-banner" as const : "digital-oil-painting-banner" as const };
    });
    await database.insert(galleryDesigns).values(designs);
    const query = { page: 1, productSlug: "digital-oil-painting-banner" as const, productTypes: [], occasions: [], birthdayAges: [], themes: [] };
    const first = await repository.listActivePage(query, 24);
    const second = await repository.listActivePage({ ...query, page: 2 }, 24);
    expect(first).toMatchObject({ total: 26, page: 1, pageCount: 2 });
    expect(first.items).toHaveLength(24);
    expect(second.items).toHaveLength(2);
    expect([...first.items, ...second.items].every((item) => item.productSlug === query.productSlug)).toBe(true);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(26);
  });

  it("accepts both wall banner products and rejects oil banner mapped to canvas", async () => {
    await database.insert(galleryDesigns).values({ ...row, productTypeSlug: "wall-hanging-banners", productSlug: "digital-oil-painting-banner" });
    expect(await repository.findActiveDesign(row.id)).toMatchObject({ productSlug: "digital-oil-painting-banner" });
    await database.update(galleryDesigns).set({ productSlug: "custom-themed-wall-banner" });
    expect(await repository.findActiveDesign(row.id)).toMatchObject({ productSlug: "custom-themed-wall-banner" });
    await expect(database.update(galleryDesigns).set({ productTypeSlug: "canvas", productSlug: "digital-oil-painting-banner" })).rejects.toThrow();
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
