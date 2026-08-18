import { z } from "zod";
import { adminAuditLogs, type AuditSummary } from "@/server/db/schema";

const auditInputSchema = z.object({
  actorUserId: z.string().trim().min(1).max(255),
  actorEmail: z.string().trim().toLowerCase().email().max(320),
  action: z.string().trim().min(1).max(120),
  resourceType: z.string().trim().min(1).max(80),
  resourceId: z.string().trim().min(1).max(255).optional(),
  beforeSummary: z.record(z.string(), z.unknown()).optional(),
  afterSummary: z.record(z.string(), z.unknown()).optional(),
  requestSource: z.string().trim().min(1).max(255).optional(),
  result: z.enum(["success", "failure"]),
  idempotencyKey: z.string().trim().min(1).max(255),
});

const sensitiveKey = /(?:secret|password|token|cookie|authorization|credential)/i;
const rawRequestKey = /^(?:body|rawRequest|rawPayload|rawBody|rawRequestBody|rawPayloadBody)$/i;

function sanitizeValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value
      .map(sanitizeValue)
      .filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !sensitiveKey.test(key) && !rawRequestKey.test(key))
        .map(([key, child]) => [key, sanitizeValue(child)])
        .filter(([, child]) => child !== undefined),
    );
  }
  return undefined;
}

function sanitizeSummary(value: Record<string, unknown> | undefined) {
  return value ? sanitizeValue(value) as AuditSummary : undefined;
}

export type AdminAuditInput = z.input<typeof auditInputSchema>;
export type AdminAuditRecord = z.output<typeof auditInputSchema>;

export function buildAuditRecord(input: AdminAuditInput): AdminAuditRecord {
  const result = auditInputSchema.safeParse(input);
  if (!result.success) throw new Error("Invalid audit record");
  return Object.freeze({
    ...result.data,
    ...(result.data.beforeSummary
      ? { beforeSummary: sanitizeSummary(result.data.beforeSummary) }
      : {}),
    ...(result.data.afterSummary
      ? { afterSummary: sanitizeSummary(result.data.afterSummary) }
      : {}),
  });
}

type AuditInsertExecutor = Readonly<{
  insert: (table: typeof adminAuditLogs) => {
    values: (record: typeof adminAuditLogs.$inferInsert) => unknown;
  };
}>;

export function writeAdminAudit(
  executor: AuditInsertExecutor,
  input: AdminAuditInput,
) {
  return executor.insert(adminAuditLogs).values(buildAuditRecord(input));
}
