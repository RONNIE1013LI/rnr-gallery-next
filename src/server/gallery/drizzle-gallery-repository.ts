import { isDeepStrictEqual } from "node:util";
import { and, asc, desc, eq, max, sql } from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";
import { galleryDesignRevisions, galleryDesigns } from "@/server/db/schema";
import type { GalleryDesignRevisionSnapshot, GalleryDesignStatus } from "@/server/db/schema/gallery";
import type {
  AdminGalleryRepository,
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

function revisionSnapshot(row: typeof galleryDesigns.$inferSelect): GalleryDesignRevisionSnapshot {
  return Object.freeze({
    ...comparable(row),
    status: row.status,
    trashedAt: row.trashedAt?.toISOString() ?? null,
  });
}

async function revise(
  transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
  row: typeof galleryDesigns.$inferSelect,
  actorUserId: string,
) {
  const [latest] = await transaction.select({ value: max(galleryDesignRevisions.revisionNumber) })
    .from(galleryDesignRevisions)
    .where(eq(galleryDesignRevisions.designId, row.id));
  await transaction.insert(galleryDesignRevisions).values({
    designId: row.id,
    revisionNumber: (latest?.value ?? 0) + 1,
    priorSnapshot: revisionSnapshot(row),
    actorUserId,
  });
}

export function createDrizzleGalleryRepository(
  database: Database,
): GalleryRepository & AdminGalleryRepository {
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
    async findDesign(designId) {
      const [row] = await database.select().from(galleryDesigns)
        .where(eq(galleryDesigns.id, designId)).limit(1);
      return row ? Object.freeze({
        ...comparable(row), createdAt: row.createdAt, updatedAt: row.updatedAt,
        status: row.status, trashedAt: row.trashedAt,
      }) : null;
    },
    async listAdminCandidates() {
      const rows = await database.select().from(galleryDesigns)
        .orderBy(desc(galleryDesigns.updatedAt), asc(galleryDesigns.id));
      return Object.freeze(rows.map((row) => Object.freeze({
        ...comparable(row), createdAt: row.createdAt, updatedAt: row.updatedAt,
        status: row.status, trashedAt: row.trashedAt,
      })));
    },
    async createDesign(row) {
      await database.insert(galleryDesigns).values({
        ...row, status: "active", trashedAt: null,
      });
    },
    async updateDesign(designId, update, actorUserId) {
      return database.transaction(async (transaction) => {
        const [current] = await transaction.select().from(galleryDesigns)
          .where(eq(galleryDesigns.id, designId)).limit(1).for("update");
        if (!current) return false;
        await revise(transaction, current, actorUserId);
        const [updated] = await transaction.update(galleryDesigns)
          .set({ ...update, updatedAt: new Date() })
          .where(eq(galleryDesigns.id, designId)).returning({ id: galleryDesigns.id });
        return Boolean(updated);
      });
    },
    async setDesignStatus(designId, status, actorUserId) {
      return database.transaction(async (transaction) => {
        const [current] = await transaction.select().from(galleryDesigns)
          .where(eq(galleryDesigns.id, designId)).limit(1).for("update");
        if (!current) return false;
        if (current.status === status) return true;
        await revise(transaction, current, actorUserId);
        const nextStatus = status as GalleryDesignStatus;
        const [updated] = await transaction.update(galleryDesigns).set({
          status: nextStatus,
          trashedAt: status === "trashed" ? new Date() : null,
          updatedAt: new Date(),
        }).where(and(eq(galleryDesigns.id, designId), eq(galleryDesigns.status, current.status)))
          .returning({ id: galleryDesigns.id });
        return Boolean(updated);
      });
    },
  };
}
