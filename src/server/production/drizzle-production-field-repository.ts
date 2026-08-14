import { and, asc, eq, sql } from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";
import {
  adminAuditLogs,
  productionFieldDefinitions,
  productionFieldValues,
} from "@/server/db/schema";
import { buildAuditRecord } from "@/server/admin/audit-service";
import {
  ProductionFieldConflictError,
  type ProductionFieldDefinition,
  type ProductionFieldRepository,
} from "./production-field-service";

type Database = ReturnType<typeof getDatabase>;

function record(row: typeof productionFieldDefinitions.$inferSelect): ProductionFieldDefinition {
  return Object.freeze({
    ...row,
    options: Object.freeze([...row.options]),
  });
}

export function createDrizzleProductionFieldRepository(database: Database): ProductionFieldRepository {
  return {
    async list() {
      const rows = await database.select().from(productionFieldDefinitions)
        .orderBy(asc(productionFieldDefinitions.section), asc(productionFieldDefinitions.sortOrder), asc(productionFieldDefinitions.label));
      return Object.freeze(rows.map(record));
    },

    async create(input) {
      return database.transaction(async (transaction) => {
        const [field] = await transaction.insert(productionFieldDefinitions).values({
          fieldKey: input.fieldKey,
          label: input.label,
          fieldType: input.fieldType,
          section: input.section,
          options: [...input.options],
          required: input.required,
          enabled: input.enabled,
          showOnCreate: input.showOnCreate,
          showOnDetail: input.showOnDetail,
          showOnList: input.showOnList,
          legacyOnly: input.legacyOnly,
          sortOrder: input.sortOrder,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        }).returning({ id: productionFieldDefinitions.id, fieldKey: productionFieldDefinitions.fieldKey });
        await transaction.insert(adminAuditLogs).values(buildAuditRecord({
          actorUserId: input.actor.userId,
          actorEmail: input.actor.email,
          action: "production_field.created",
          resourceType: "production_field",
          resourceId: field.id,
          afterSummary: { fieldKey: field.fieldKey, label: input.label, fieldType: input.fieldType, section: input.section },
          requestSource: "admin.jobs.fields",
          result: "success",
          idempotencyKey: input.idempotencyKey,
        }));
        return field;
      }).catch((error) => {
        if ((error as { code?: string }).code === "23505") {
          throw new ProductionFieldConflictError("A production field already uses that key");
        }
        throw error;
      });
    },

    async update(input) {
      const [priorAudit] = await database.select({ id: adminAuditLogs.id }).from(adminAuditLogs)
        .where(and(
          eq(adminAuditLogs.actorUserId, input.actor.userId),
          eq(adminAuditLogs.action, "production_field.updated"),
          eq(adminAuditLogs.idempotencyKey, input.idempotencyKey),
        )).limit(1);
      if (priorAudit) return "duplicate" as const;

      return database.transaction(async (transaction) => {
        const [current] = await transaction.select().from(productionFieldDefinitions)
          .where(eq(productionFieldDefinitions.id, input.fieldId)).for("update").limit(1);
        if (!current) return "not_found" as const;
        if (current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) return "conflict" as const;
        if (current.fieldType !== input.fieldType) {
          const [usage] = await transaction.select({ count: sql<number>`count(*)::int` })
            .from(productionFieldValues)
            .where(eq(productionFieldValues.fieldId, input.fieldId));
          if ((usage?.count ?? 0) > 0) return "conflict" as const;
        }
        const [updated] = await transaction.update(productionFieldDefinitions).set({
          label: input.label,
          fieldType: input.fieldType,
          section: input.section,
          options: [...input.options],
          required: input.required,
          enabled: input.enabled,
          showOnCreate: input.showOnCreate,
          showOnDetail: input.showOnDetail,
          showOnList: input.showOnList,
          legacyOnly: input.legacyOnly,
          sortOrder: input.sortOrder,
          updatedAt: input.updatedAt,
        }).where(and(
          eq(productionFieldDefinitions.id, input.fieldId),
          eq(productionFieldDefinitions.updatedAt, input.expectedUpdatedAt),
        )).returning({ id: productionFieldDefinitions.id });
        if (!updated) return "conflict" as const;
        await transaction.insert(adminAuditLogs).values(buildAuditRecord({
          actorUserId: input.actor.userId,
          actorEmail: input.actor.email,
          action: "production_field.updated",
          resourceType: "production_field",
          resourceId: input.fieldId,
          beforeSummary: { label: current.label, fieldType: current.fieldType, section: current.section, enabled: current.enabled },
          afterSummary: { label: input.label, fieldType: input.fieldType, section: input.section, enabled: input.enabled },
          requestSource: "admin.jobs.fields",
          result: "success",
          idempotencyKey: input.idempotencyKey,
        }));
        return "updated" as const;
      });
    },
  };
}
