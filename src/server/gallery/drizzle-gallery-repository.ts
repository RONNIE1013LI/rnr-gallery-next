import { isDeepStrictEqual } from "node:util";
import { asc, desc, eq, sql } from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";
import { galleryDesigns } from "@/server/db/schema";
import type {
  GalleryImportRow,
  GalleryRepository,
} from "./gallery-repository";

type Database = ReturnType<typeof getDatabase>;

export class GalleryImportConflictError extends Error {
  constructor() {
    super("Gallery already contains different data");
    this.name = "GalleryImportConflictError";
  }
}

function comparable(row: typeof galleryDesigns.$inferSelect): GalleryImportRow {
  return Object.freeze({
    id: row.id,
    productTypeSlug: row.productTypeSlug,
    occasionSlug: row.occasionSlug,
    subOccasion: row.subOccasion,
    themeSlugs: row.themeSlugs,
    altText: row.altText,
    productSlug: row.productSlug,
    storageKey: row.storageKey,
    contentHash: row.contentHash,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
  });
}

export function createDrizzleGalleryRepository(
  database: Database,
): GalleryRepository {
  return {
    async replaceInitialImport(rows) {
      const incoming = [...rows].sort((left, right) =>
        left.id.localeCompare(right.id),
      );
      return database.transaction(async (transaction) => {
        await transaction.execute(sql`select pg_advisory_xact_lock(734_357_001)`);
        const existing = await transaction
          .select()
          .from(galleryDesigns)
          .orderBy(asc(galleryDesigns.id));

        if (existing.length === 0) {
          if (incoming.length > 0) {
            await transaction.insert(galleryDesigns).values(
              incoming.map((row) => ({
                ...row,
                status: "active" as const,
                trashedAt: null,
              })),
            );
          }
          return Object.freeze({ imported: incoming.length, unchanged: 0 });
        }

        const current = existing.map(comparable);
        if (!isDeepStrictEqual(current, incoming)) {
          throw new GalleryImportConflictError();
        }
        return Object.freeze({ imported: 0, unchanged: current.length });
      });
    },
    async listActiveCandidates() {
      const rows = await database
        .select()
        .from(galleryDesigns)
        .where(eq(galleryDesigns.status, "active"))
        .orderBy(desc(galleryDesigns.createdAt), asc(galleryDesigns.id));
      return Object.freeze(rows.map((row) => Object.freeze({
        ...comparable(row),
        createdAt: row.createdAt,
      })));
    },
    async findActiveImage(designId) {
      const [row] = await database
        .select({
          id: galleryDesigns.id,
          storageKey: galleryDesigns.storageKey,
          contentHash: galleryDesigns.contentHash,
          mimeType: galleryDesigns.mimeType,
        })
        .from(galleryDesigns)
        .where(sql`${galleryDesigns.id} = ${designId} and ${galleryDesigns.status} = 'active'`)
        .limit(1);
      return row ? Object.freeze(row) : null;
    },
    async findActiveDesign(designId) {
      const [row] = await database
        .select()
        .from(galleryDesigns)
        .where(sql`${galleryDesigns.id} = ${designId} and ${galleryDesigns.status} = 'active'`)
        .limit(1);
      return row ? Object.freeze({ ...comparable(row), createdAt: row.createdAt }) : null;
    },
  };
}
