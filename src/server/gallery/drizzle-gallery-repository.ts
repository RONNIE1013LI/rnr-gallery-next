import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, like, max, or, sql, type SQL } from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";
import { adminAuditLogs, galleryDesignRevisions, galleryDesigns, user } from "@/server/db/schema";
import { buildAuditRecord } from "@/server/admin/audit-service";
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

function auditSummary(row: Partial<GalleryImportRow> & { status?: GalleryDesignStatus }) {
  return Object.freeze({
    ...(row.productTypeSlug ? { productTypeSlug: row.productTypeSlug } : {}),
    ...(row.occasionSlug ? { occasionSlug: row.occasionSlug } : {}),
    ...(row.subOccasion !== undefined ? { subOccasion: row.subOccasion } : {}),
    ...(row.themeSlugs ? { themeSlugs: row.themeSlugs } : {}),
    ...(row.altText ? { altText: row.altText } : {}),
    ...(row.productSlug ? { productSlug: row.productSlug } : {}),
    ...(row.width ? { width: row.width } : {}),
    ...(row.height ? { height: row.height } : {}),
    ...(row.mimeType ? { mimeType: row.mimeType } : {}),
    ...(row.status ? { status: row.status } : {}),
  });
}

async function actorEmail(
  executor: Parameters<Parameters<Database["transaction"]>[0]>[0],
  actorUserId: string,
) {
  const [actor] = await executor.select({ email: user.email }).from(user)
    .where(eq(user.id, actorUserId)).limit(1);
  return actor?.email ?? "unknown@invalid.local";
}

async function auditGalleryMutation(
  executor: Parameters<Parameters<Database["transaction"]>[0]>[0],
  input: Readonly<{
    actorUserId: string;
    action: string;
    designId: string;
    beforeSummary?: Record<string, unknown>;
    afterSummary?: Record<string, unknown>;
  }>,
) {
  await executor.insert(adminAuditLogs).values(buildAuditRecord({
    actorUserId: input.actorUserId,
    actorEmail: await actorEmail(executor, input.actorUserId),
    action: input.action,
    resourceType: "gallery_design",
    resourceId: input.designId,
    ...(input.beforeSummary ? { beforeSummary: input.beforeSummary } : {}),
    ...(input.afterSummary ? { afterSummary: input.afterSummary } : {}),
    result: "success",
    idempotencyKey: randomUUID(),
  }));
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
    async listActivePage(query, pageSize) {
      const conditions: SQL[] = [eq(galleryDesigns.status, "active")];
      if (query.productTypes.length > 0) {
        conditions.push(inArray(galleryDesigns.productTypeSlug, query.productTypes));
      }
      if (query.occasions.length > 0) {
        conditions.push(inArray(galleryDesigns.occasionSlug, query.occasions));
      }
      if (query.birthdayAges.length > 0) {
        conditions.push(inArray(galleryDesigns.subOccasion, query.birthdayAges));
      }
      if (query.themes.length > 0) {
        const themeCondition = or(...query.themes.map((theme) =>
          sql`${galleryDesigns.themeSlugs} @> ${JSON.stringify([theme])}::jsonb`,
        ));
        if (themeCondition) conditions.push(themeCondition);
      }
      const where = and(...conditions);
      const [countRow] = await database.select({ value: sql<number>`count(*)::int` })
        .from(galleryDesigns)
        .where(where);
      const total = countRow?.value ?? 0;
      const pageCount = Math.max(1, Math.ceil(total / pageSize));
      const page = Math.min(query.page, pageCount);
      const rows = await database.select().from(galleryDesigns)
        .where(where)
        .orderBy(desc(galleryDesigns.createdAt), asc(galleryDesigns.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      return Object.freeze({
        items: Object.freeze(rows.map((row) => Object.freeze({
          ...comparable(row),
          createdAt: row.createdAt,
        }))),
        total,
        page,
        pageCount,
      });
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
    async findActiveDesignByIdPrefix(designIdPrefix) {
      const rows = await database
        .select()
        .from(galleryDesigns)
        .where(and(
          eq(galleryDesigns.status, "active"),
          like(galleryDesigns.id, `${designIdPrefix}%`),
        ))
        .orderBy(asc(galleryDesigns.id))
        .limit(2);
      if (rows.length !== 1) return null;
      const row = rows[0];
      return Object.freeze({ ...comparable(row), createdAt: row.createdAt });
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
    async createDesign(row, actorUserId) {
      await database.transaction(async (transaction) => {
        await transaction.insert(galleryDesigns).values({
          ...row, status: "active", trashedAt: null,
        });
        await auditGalleryMutation(transaction, {
          actorUserId,
          action: "gallery_design.created",
          designId: row.id,
          afterSummary: auditSummary({ ...row, status: "active" }),
        });
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
        if (updated) {
          await auditGalleryMutation(transaction, {
            actorUserId,
            action: "gallery_design.updated",
            designId,
            beforeSummary: auditSummary({ ...comparable(current), status: current.status }),
            afterSummary: auditSummary({ ...comparable(current), ...update, status: current.status }),
          });
        }
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
        if (updated) {
          await auditGalleryMutation(transaction, {
            actorUserId,
            action: status === "trashed" ? "gallery_design.trashed" : "gallery_design.restored",
            designId,
            beforeSummary: auditSummary({ ...comparable(current), status: current.status }),
            afterSummary: auditSummary({ ...comparable(current), status: nextStatus }),
          });
        }
        return Boolean(updated);
      });
    },
  };
}
