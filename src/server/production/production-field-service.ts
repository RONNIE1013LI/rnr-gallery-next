import { z } from "zod";
import type { ProductionFieldSection, ProductionFieldType } from "@/server/db/schema";

export type ProductionFieldDefinition = Readonly<{
  id: string;
  fieldKey: string;
  label: string;
  fieldType: ProductionFieldType;
  section: ProductionFieldSection;
  options: readonly string[];
  required: boolean;
  enabled: boolean;
  showOnCreate: boolean;
  showOnDetail: boolean;
  showOnList: boolean;
  legacyOnly: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}>;

type Actor = Readonly<{ userId: string; email: string }>;
type FieldValues = Omit<ProductionFieldDefinition, "id" | "fieldKey" | "createdAt" | "updatedAt">;
export interface ProductionFieldRepository {
  list(): Promise<readonly ProductionFieldDefinition[]>;
  create(input: Readonly<FieldValues & {
    fieldKey: string;
    idempotencyKey: string;
    actor: Actor;
    createdAt: Date;
  }>): Promise<Readonly<{ id: string; fieldKey: string }>>;
  update(input: Readonly<FieldValues & {
    fieldId: string;
    idempotencyKey: string;
    expectedUpdatedAt: Date;
    actor: Actor;
    updatedAt: Date;
  }>): Promise<"updated" | "duplicate" | "conflict" | "not_found">;
}

export class ProductionFieldValidationError extends Error {
  constructor() {
    super("Production field configuration is invalid");
    this.name = "ProductionFieldValidationError";
  }
}

export class ProductionFieldConflictError extends Error {
  constructor(message = "The production field changed before this update was saved") {
    super(message);
    this.name = "ProductionFieldConflictError";
  }
}

export class ProductionFieldNotFoundError extends Error {
  constructor() {
    super("Production field not found");
    this.name = "ProductionFieldNotFoundError";
  }
}

const actorSchema = z.object({
  userId: z.string().trim().min(1).max(255),
  email: z.string().trim().toLowerCase().email().max(320),
}).strict();
const fieldTypes = ["text", "textarea", "number", "date", "select", "radio", "file"] as const;
const sections = ["order", "product", "payment", "delivery", "customer", "design", "production", "finance", "legacy"] as const;
const optionsSchema = z.array(z.string().trim().min(1).max(190)).max(100)
  .transform((options) => [...new Set(options)]);
const fieldValuesSchema = z.object({
  label: z.string().trim().min(1).max(190),
  fieldType: z.enum(fieldTypes),
  section: z.enum(sections),
  options: optionsSchema,
  required: z.boolean(),
  enabled: z.boolean(),
  showOnCreate: z.boolean(),
  showOnDetail: z.boolean(),
  showOnList: z.boolean(),
  legacyOnly: z.boolean(),
  sortOrder: z.number().int().min(-10_000).max(10_000),
}).strict().superRefine((input, context) => {
  const optionField = input.fieldType === "select" || input.fieldType === "radio";
  if (optionField && input.options.length === 0) {
    context.addIssue({ code: "custom", path: ["options"], message: "Options are required" });
  }
  if (!optionField && input.options.length > 0) {
    context.addIssue({ code: "custom", path: ["options"], message: "Options are not supported" });
  }
  if (input.legacyOnly && input.showOnCreate) {
    context.addIssue({ code: "custom", path: ["showOnCreate"], message: "Legacy fields cannot appear on create" });
  }
  if (input.fieldType === "file" && input.showOnCreate) {
    context.addIssue({ code: "custom", path: ["showOnCreate"], message: "Files use the private production upload workflow" });
  }
});
const createSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(255),
  fieldKey: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{1,63}$/),
  label: z.string(),
  fieldType: z.unknown(),
  section: z.unknown(),
  options: z.unknown(),
  required: z.unknown(),
  enabled: z.unknown(),
  showOnCreate: z.unknown(),
  showOnDetail: z.unknown(),
  showOnList: z.unknown(),
  legacyOnly: z.unknown(),
  sortOrder: z.unknown(),
}).strict();
const updateSchema = z.object({
  fieldId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(8).max(255),
  expectedUpdatedAt: z.string().datetime(),
  label: z.string(),
  fieldType: z.unknown(),
  section: z.unknown(),
  options: z.unknown(),
  required: z.unknown(),
  enabled: z.unknown(),
  showOnCreate: z.unknown(),
  showOnDetail: z.unknown(),
  showOnList: z.unknown(),
  legacyOnly: z.unknown(),
  sortOrder: z.unknown(),
}).strict();

function parseActor(input: unknown) {
  const actor = actorSchema.safeParse(input);
  if (!actor.success) throw new ProductionFieldValidationError();
  return actor.data;
}

function parseValues(input: Record<string, unknown>) {
  const values = fieldValuesSchema.safeParse(input);
  if (!values.success) throw new ProductionFieldValidationError();
  return values.data;
}

export function createProductionFieldService(
  repository: ProductionFieldRepository,
  dependencies: Readonly<{ now?: () => Date }> = {},
) {
  return Object.freeze({
    list: () => repository.list(),

    async create(actorInput: unknown, input: unknown) {
      const actor = parseActor(actorInput);
      const envelope = createSchema.safeParse(input);
      if (!envelope.success) throw new ProductionFieldValidationError();
      const { idempotencyKey, fieldKey, ...rawValues } = envelope.data;
      const values = parseValues(rawValues);
      return repository.create({
        ...values,
        idempotencyKey,
        fieldKey,
        actor,
        createdAt: dependencies.now?.() ?? new Date(),
      });
    },

    async update(actorInput: unknown, input: unknown) {
      const actor = parseActor(actorInput);
      const envelope = updateSchema.safeParse(input);
      if (!envelope.success) throw new ProductionFieldValidationError();
      const { fieldId, idempotencyKey, expectedUpdatedAt, ...rawValues } = envelope.data;
      const values = parseValues(rawValues);
      const result = await repository.update({
        ...values,
        fieldId,
        idempotencyKey,
        expectedUpdatedAt: new Date(expectedUpdatedAt),
        actor,
        updatedAt: dependencies.now?.() ?? new Date(),
      });
      if (result === "conflict") throw new ProductionFieldConflictError();
      if (result === "not_found") throw new ProductionFieldNotFoundError();
      return result;
    },
  });
}
