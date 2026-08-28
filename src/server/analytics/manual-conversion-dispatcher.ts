import { and, eq, sql } from "drizzle-orm";
import type { ManualConversionCandidate } from "@/domain/analytics/manual-order-attribution";
import { buildAuditRecord } from "@/server/admin/audit-service";
import type { SafeMetaEvent } from "@/server/analytics/meta-capi-client";
import type { getDatabase } from "@/server/db/client";
import { adminAuditLogs } from "@/server/db/schema";

type SendResult = "disabled" | "sent" | "failed";
type DispatchResult = SendResult | "already_sent";
type Actor = Readonly<{ userId: string; email: string }>;
type AuditIdentity = Readonly<{
  actor: Actor;
  jobId: string;
  destination: "meta" | "google";
  transactionId: string;
  paidAt: Date;
  currency: "NZD" | "AUD";
  value: number;
}>;

export interface ManualConversionSuccessStore {
  runOnce(
    input: AuditIdentity,
    operation: () => Promise<SendResult>,
  ): Promise<DispatchResult>;
}

export function manualOfflineConversionsEnabled(
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>> = process.env,
) {
  return env.MANUAL_OFFLINE_CONVERSIONS_ENABLED === "true";
}

function metaEvent(candidate: ManualConversionCandidate): SafeMetaEvent | null {
  if (candidate.destination !== "meta" || !candidate.meta) return null;
  const { actionSource, ...matching } = candidate.meta;
  const base = {
    name: "Purchase",
    eventId: `purchase:${candidate.transactionId}`,
    eventTime: Math.floor(candidate.paidAt.getTime() / 1_000),
    currency: candidate.currency,
    value: candidate.value,
    ...matching,
  } as const;
  return actionSource === "business_messaging"
    ? Object.freeze({ ...base, actionSource })
    : Object.freeze({ ...base, sourceUrl: "https://rnrgallery.com/contact" });
}

export function createManualConversionDispatcher(dependencies: Readonly<{
  listCandidates: (jobId: string) => Promise<readonly ManualConversionCandidate[]>;
  successStore: ManualConversionSuccessStore;
  metaSend: (event: SafeMetaEvent) => Promise<SendResult>;
}>) {
  return Object.freeze({
    async dispatch(jobId: string, actor: Actor) {
      const candidates = await dependencies.listCandidates(jobId);
      const results: Partial<Record<"meta" | "google", DispatchResult>> = {};
      for (const candidate of candidates) {
        if (candidate.destination === "google") {
          // Phase 0C deliberately has no durable Google delivery outbox.
          results.google = "disabled";
          continue;
        }
        const audit = Object.freeze({
          actor,
          jobId,
          destination: candidate.destination,
          transactionId: candidate.transactionId,
          paidAt: candidate.paidAt,
          currency: candidate.currency,
          value: candidate.value,
        });
        try {
          results[candidate.destination] = await dependencies.successStore.runOnce(
            audit,
            async () => {
              const event = metaEvent(candidate);
              return event ? dependencies.metaSend(event) : "failed";
            },
          );
        } catch {
          results[candidate.destination] = "failed";
        }
      }
      return Object.freeze(results);
    },
  });
}

export function createManualConversionObserver(
  scheduleAfter: (task: () => Promise<void>) => void,
  dispatch: (jobId: string, actor: Actor) => Promise<unknown>,
) {
  return function onManualPaid(jobId: string, actor: Actor) {
    try {
      scheduleAfter(async () => {
        try {
          await dispatch(jobId, actor);
        } catch {
          // The committed manual job remains authoritative when measurement fails.
        }
      });
    } catch {
      // Scheduling is measurement infrastructure and cannot change the saved job.
    }
  };
}

export function createDrizzleManualConversionSuccessStore(
  database: ReturnType<typeof getDatabase>,
): ManualConversionSuccessStore {
  return Object.freeze({
    async runOnce(
      input: AuditIdentity,
      operation: () => Promise<SendResult>,
    ): Promise<DispatchResult> {
      const action = `analytics.manual_conversion.${input.destination}.sent`;
      const idempotencyKey = `manual-conversion:${input.destination}:${input.transactionId}`;
      return database.transaction(async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${idempotencyKey}, 0))`,
        );
        const [existing] = await transaction.select({ id: adminAuditLogs.id })
          .from(adminAuditLogs)
          .where(and(
            eq(adminAuditLogs.action, action),
            eq(adminAuditLogs.resourceType, "production_job"),
            eq(adminAuditLogs.resourceId, input.jobId),
            eq(adminAuditLogs.idempotencyKey, idempotencyKey),
            eq(adminAuditLogs.result, "success"),
          ))
          .limit(1);
        if (existing) return "already_sent" as const;
        const result = await operation();
        if (result !== "sent") return result;
        await transaction.insert(adminAuditLogs).values(buildAuditRecord({
          actorUserId: input.actor.userId,
          actorEmail: input.actor.email,
          action,
          resourceType: "production_job",
          resourceId: input.jobId,
          afterSummary: {
            destination: input.destination,
            transactionId: input.transactionId,
            paidAt: input.paidAt,
            currency: input.currency,
            value: input.value,
          },
          requestSource: "analytics.manual_conversion",
          result: "success",
          idempotencyKey,
        }));
        return "sent" as const;
      });
    },
  });
}
