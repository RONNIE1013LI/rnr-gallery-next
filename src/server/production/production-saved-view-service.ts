import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import type { getDatabase } from "@/server/db/client";
import { adminAuditLogs, productionSavedViews } from "@/server/db/schema";
import { buildAuditRecord } from "@/server/admin/audit-service";
import {
  encodeFormFilterCondition,
  parseFormWorkbenchQuery,
} from "@/server/forms/forms-workbench-service";

const actorSchema = z.object({
  userId: z.string().trim().min(1).max(255),
  email: z.string().trim().toLowerCase().email().max(320),
}).strict();
const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  queryString: z.string().trim().min(1).max(2_000),
}).strict();

const allowedValues = {
  source: new Set(["web", "manual"]),
  status: new Set(["new", "designing", "awaiting_customer", "ready_to_print", "printing", "on_hold", "shipped", "completed", "cancelled"]),
  payment: new Set(["awaiting_payment", "processing", "paid", "failed", "cancelled", "refunded"]),
  urgent: new Set(["yes", "no"]),
  sort: new Set(["created", "updated", "needed"]),
  direction: new Set(["asc", "desc"]),
} as const;
const keyOrder = ["source", "status", "payment", "urgent", "assigned", "from", "to", "sort", "direction"] as const;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export type ProductionSavedView = Readonly<{
  id: string;
  name: string;
  queryString: string;
}>;

export interface ProductionSavedViewRepository {
  list(userId: string): Promise<readonly ProductionSavedView[]>;
  create(input: Readonly<{ userId: string; actorEmail: string; name: string; queryString: string }>): Promise<Readonly<{ result: "created" | "duplicate" | "conflict"; view: ProductionSavedView }>>;
  update(input: Readonly<{ userId: string; actorEmail: string; viewId: string; name: string; queryString: string }>): Promise<Readonly<{ result: "updated" | "unchanged" | "not_found" | "conflict"; view?: ProductionSavedView }>>;
  remove(userId: string, actorEmail: string, viewId: string): Promise<"deleted" | "not_found">;
}

export class ProductionSavedViewValidationError extends Error {
  constructor(message = "Saved view data is invalid") {
    super(message);
    this.name = "ProductionSavedViewValidationError";
  }
}
export class ProductionSavedViewConflictError extends Error {
  constructor() {
    super("A saved view with this name already exists");
    this.name = "ProductionSavedViewConflictError";
  }
}

export function normalizeSavedViewQuery(input: string) {
  if (input.includes("?") || input.includes("#") || input.includes("://")) throw new ProductionSavedViewValidationError();
  const source = new URLSearchParams(input);
  for (const key of source.keys()) {
    if (!keyOrder.includes(key as typeof keyOrder[number])) throw new ProductionSavedViewValidationError("Only operational filters can be saved");
  }
  const normalized = new URLSearchParams();
  for (const key of keyOrder) {
    const values = source.getAll(key);
    if (values.length > 1) throw new ProductionSavedViewValidationError();
    const value = values[0]?.trim();
    if (!value) continue;
    if (key === "assigned") {
      if (value.length > 255) throw new ProductionSavedViewValidationError();
    } else if (key === "from" || key === "to") {
      if (!datePattern.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new ProductionSavedViewValidationError();
    } else if (!allowedValues[key].has(value as never)) {
      throw new ProductionSavedViewValidationError();
    }
    normalized.set(key, value);
  }
  const output = normalized.toString();
  if (!output) throw new ProductionSavedViewValidationError("Choose at least one operational filter");
  return output;
}

export function normalizeFormsSavedViewQuery(input: string) {
  if (input.length > 2_000 || input.includes("?") || input.includes("#") || input.includes("://")) {
    throw new ProductionSavedViewValidationError();
  }
  const source = new URLSearchParams(input);
  const allowed = new Set(["match", "preset", "sort", "direction", "filter"]);
  for (const key of source.keys()) {
    if (!allowed.has(key)) throw new ProductionSavedViewValidationError("Only operational filters can be saved");
  }
  for (const key of ["match", "preset", "sort", "direction"]) {
    if (source.getAll(key).length > 1) throw new ProductionSavedViewValidationError();
  }
  const rawFilters = source.getAll("filter");
  if (rawFilters.length > 20) throw new ProductionSavedViewValidationError();
  const parsed = parseFormWorkbenchQuery({
    match: source.get("match") ?? undefined,
    preset: source.get("preset") ?? undefined,
    sort: source.get("sort") ?? undefined,
    direction: source.get("direction") ?? undefined,
    filter: rawFilters,
  });
  if (parsed.conditions.length !== rawFilters.length) throw new ProductionSavedViewValidationError();
  if (source.has("match") && !["and", "or"].includes(source.get("match") ?? "")) throw new ProductionSavedViewValidationError();
  if (source.has("preset") && !["all", "lastSixMonths", "lastYear"].includes(source.get("preset") ?? "")) throw new ProductionSavedViewValidationError();
  if (source.has("sort") && !["submittedAt", "updatedAt", "neededDate", "reference"].includes(source.get("sort") ?? "")) throw new ProductionSavedViewValidationError();
  if (source.has("direction") && !["asc", "desc"].includes(source.get("direction") ?? "")) throw new ProductionSavedViewValidationError();
  const output = new URLSearchParams();
  if (parsed.match !== "and") output.set("match", parsed.match);
  if (parsed.preset !== "all") output.set("preset", parsed.preset);
  if (parsed.sort !== "submittedAt") output.set("sort", parsed.sort);
  if (parsed.direction !== "desc") output.set("direction", parsed.direction);
  for (const condition of parsed.conditions) output.append("filter", encodeFormFilterCondition(condition));
  const normalized = output.toString();
  if (!normalized) throw new ProductionSavedViewValidationError("Choose at least one operational filter");
  return normalized;
}

export function createProductionSavedViewService(repository: ProductionSavedViewRepository) {
  return Object.freeze({
    async list(actorInput: unknown) {
      const actor = actorSchema.safeParse(actorInput);
      if (!actor.success) throw new ProductionSavedViewValidationError();
      return repository.list(actor.data.userId);
    },
    async create(actorInput: unknown, input: unknown) {
      const actor = actorSchema.safeParse(actorInput);
      const parsed = createSchema.safeParse(input);
      if (!actor.success || !parsed.success) throw new ProductionSavedViewValidationError();
      const result = await repository.create({
        userId: actor.data.userId,
        actorEmail: actor.data.email,
        name: parsed.data.name,
        queryString: normalizeSavedViewQuery(parsed.data.queryString),
      });
      if (result.result === "conflict") throw new ProductionSavedViewConflictError();
      return result;
    },
    async remove(actorInput: unknown, viewIdInput: unknown) {
      const actor = actorSchema.safeParse(actorInput);
      const viewId = z.string().uuid().safeParse(viewIdInput);
      if (!actor.success || !viewId.success) throw new ProductionSavedViewValidationError();
      return repository.remove(actor.data.userId, actor.data.email, viewId.data);
    },
  });
}

export function createFormsSavedViewService(repository: ProductionSavedViewRepository) {
  return Object.freeze({
    async list(actorInput: unknown) {
      const actor = actorSchema.safeParse(actorInput);
      if (!actor.success) throw new ProductionSavedViewValidationError();
      return repository.list(actor.data.userId);
    },
    async create(actorInput: unknown, input: unknown) {
      const actor = actorSchema.safeParse(actorInput);
      const parsed = createSchema.safeParse(input);
      if (!actor.success || !parsed.success) throw new ProductionSavedViewValidationError();
      const result = await repository.create({
        userId: actor.data.userId,
        actorEmail: actor.data.email,
        name: parsed.data.name,
        queryString: normalizeFormsSavedViewQuery(parsed.data.queryString),
      });
      if (result.result === "conflict") throw new ProductionSavedViewConflictError();
      return result;
    },
    async update(actorInput: unknown, viewIdInput: unknown, input: unknown) {
      const actor = actorSchema.safeParse(actorInput);
      const viewId = z.string().uuid().safeParse(viewIdInput);
      const parsed = createSchema.safeParse(input);
      if (!actor.success || !viewId.success || !parsed.success) throw new ProductionSavedViewValidationError();
      const result = await repository.update({
        userId: actor.data.userId,
        actorEmail: actor.data.email,
        viewId: viewId.data,
        name: parsed.data.name,
        queryString: normalizeFormsSavedViewQuery(parsed.data.queryString),
      });
      if (result.result === "conflict") throw new ProductionSavedViewConflictError();
      return result;
    },
    async remove(actorInput: unknown, viewIdInput: unknown) {
      const actor = actorSchema.safeParse(actorInput);
      const viewId = z.string().uuid().safeParse(viewIdInput);
      if (!actor.success || !viewId.success) throw new ProductionSavedViewValidationError();
      return repository.remove(actor.data.userId, actor.data.email, viewId.data);
    },
  });
}

type Database = ReturnType<typeof getDatabase>;
export function createDrizzleProductionSavedViewRepository(database: Database): ProductionSavedViewRepository {
  return {
    async list(userId) {
      const rows = await database.select({ id: productionSavedViews.id, name: productionSavedViews.name, queryString: productionSavedViews.queryString })
        .from(productionSavedViews).where(eq(productionSavedViews.userId, userId)).orderBy(asc(productionSavedViews.name));
      return Object.freeze(rows.map((row) => Object.freeze(row)));
    },
    async create(input) {
      return database.transaction(async (transaction) => {
        const [existing] = await transaction.select({ id: productionSavedViews.id, name: productionSavedViews.name, queryString: productionSavedViews.queryString })
          .from(productionSavedViews)
          .where(and(eq(productionSavedViews.userId, input.userId), eq(productionSavedViews.name, input.name)))
          .limit(1);
        if (existing) return { result: existing.queryString === input.queryString ? "duplicate" as const : "conflict" as const, view: existing };
        const [view] = await transaction.insert(productionSavedViews).values({ userId: input.userId, name: input.name, queryString: input.queryString })
          .returning({ id: productionSavedViews.id, name: productionSavedViews.name, queryString: productionSavedViews.queryString });
        await transaction.insert(adminAuditLogs).values(buildAuditRecord({
          actorUserId: input.userId, actorEmail: input.actorEmail,
          action: "production_view.created", resourceType: "production_saved_view", resourceId: view.id,
          afterSummary: { name: view.name, queryString: view.queryString }, requestSource: "admin.jobs.views",
          result: "success", idempotencyKey: `saved-view-create:${view.id}`,
        }));
        return { result: "created" as const, view };
      });
    },
    async update(input) {
      return database.transaction(async (transaction) => {
        const [existing] = await transaction.select({
          id: productionSavedViews.id,
          name: productionSavedViews.name,
          queryString: productionSavedViews.queryString,
          updatedAt: productionSavedViews.updatedAt,
        }).from(productionSavedViews)
          .where(and(eq(productionSavedViews.id, input.viewId), eq(productionSavedViews.userId, input.userId)))
          .limit(1);
        if (!existing) return { result: "not_found" as const };
        if (existing.name === input.name && existing.queryString === input.queryString) {
          return { result: "unchanged" as const, view: { id: existing.id, name: existing.name, queryString: existing.queryString } };
        }
        const [nameConflict] = await transaction.select({ id: productionSavedViews.id })
          .from(productionSavedViews)
          .where(and(
            eq(productionSavedViews.userId, input.userId),
            eq(productionSavedViews.name, input.name),
            ne(productionSavedViews.id, input.viewId),
          ))
          .limit(1);
        if (nameConflict) return { result: "conflict" as const };
        const [view] = await transaction.update(productionSavedViews)
          .set({ name: input.name, queryString: input.queryString })
          .where(and(eq(productionSavedViews.id, input.viewId), eq(productionSavedViews.userId, input.userId)))
          .returning({ id: productionSavedViews.id, name: productionSavedViews.name, queryString: productionSavedViews.queryString });
        await transaction.insert(adminAuditLogs).values(buildAuditRecord({
          actorUserId: input.userId, actorEmail: input.actorEmail,
          action: "production_view.updated", resourceType: "production_saved_view", resourceId: view.id,
          beforeSummary: { name: existing.name, queryString: existing.queryString },
          afterSummary: { name: view.name, queryString: view.queryString }, requestSource: "admin.jobs.views",
          result: "success", idempotencyKey: `saved-view-update:${view.id}:${existing.updatedAt.getTime()}`,
        }));
        return { result: "updated" as const, view };
      });
    },
    async remove(userId, actorEmail, viewId) {
      return database.transaction(async (transaction) => {
        const [deleted] = await transaction.delete(productionSavedViews)
          .where(and(eq(productionSavedViews.id, viewId), eq(productionSavedViews.userId, userId)))
          .returning({ id: productionSavedViews.id, name: productionSavedViews.name });
        if (!deleted) return "not_found" as const;
        await transaction.insert(adminAuditLogs).values(buildAuditRecord({
          actorUserId: userId, actorEmail,
          action: "production_view.deleted", resourceType: "production_saved_view", resourceId: deleted.id,
          beforeSummary: { name: deleted.name }, requestSource: "admin.jobs.views",
          result: "success", idempotencyKey: `saved-view-delete:${deleted.id}`,
        }));
        return "deleted" as const;
      });
    },
  };
}
