import { randomUUID } from "node:crypto";
import { getDatabase } from "@/server/db/client";
import { adminAuditLogs } from "@/server/db/schema";
import { buildAuditRecord } from "./audit-service";

export async function recordAdminFailure(input: Readonly<{
  actor: Readonly<{ userId: string; email: string }>;
  action: string;
  resourceType: string;
  resourceId?: string;
  requestSource?: string;
  idempotencyKey?: string;
  error: unknown;
}>) {
  const key = input.idempotencyKey?.trim();
  const idempotencyKey = key && key.length >= 8 && key.length <= 220
    ? `failure:${key}`
    : `failure:${randomUUID()}`;
  const errorType = input.error instanceof Error ? input.error.name : "UnknownError";
  try {
    await getDatabase().insert(adminAuditLogs).values(buildAuditRecord({
      actorUserId: input.actor.userId,
      actorEmail: input.actor.email,
      action: input.action,
      resourceType: input.resourceType,
      ...(input.resourceId ? { resourceId: input.resourceId } : {}),
      afterSummary: { errorType },
      ...(input.requestSource ? { requestSource: input.requestSource } : {}),
      result: "failure",
      idempotencyKey,
    })).onConflictDoNothing();
  } catch {
    // A failed audit write must not replace the original safe API response.
  }
}
