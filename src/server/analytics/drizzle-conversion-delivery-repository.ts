import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { ConversionDeliveryCandidate } from "@/domain/analytics/conversion-delivery-candidate";
import type { getDatabase } from "@/server/db/client";
import {
  analyticsConversionDeliveries,
  type ConversionErrorCategory,
  type ConversionPlatform,
  type ConversionProviderDiagnostics,
} from "@/server/db/schema";

type Database = ReturnType<typeof getDatabase>;
export type ConversionDeliveryTransaction =
  Parameters<Parameters<Database["transaction"]>[0]>[0];

const redactedSnapshot = Object.freeze({ version: 1 as const, redacted: true as const });

export async function enqueueConversionDeliveries(
  transaction: ConversionDeliveryTransaction,
  candidates: readonly ConversionDeliveryCandidate[],
): Promise<number> {
  if (candidates.length === 0) return 0;
  const inserted = await transaction.insert(analyticsConversionDeliveries)
    .values(candidates.map((candidate) => ({ ...candidate, status: "pending" as const })))
    .onConflictDoNothing({
      target: [
        analyticsConversionDeliveries.platform,
        analyticsConversionDeliveries.transactionId,
      ],
    })
    .returning({ id: analyticsConversionDeliveries.id });
  return inserted.length;
}

export type ClaimedConversionDelivery = Readonly<{
  id: string;
  platform: ConversionPlatform;
  transactionId: string;
  jobId: string;
  eventType: string;
  eventOccurredAt: Date;
  eventSource: typeof analyticsConversionDeliveries.$inferSelect.eventSource;
  currency: "NZD" | "AUD";
  valueMinor: number;
  consentSnapshot: typeof analyticsConversionDeliveries.$inferSelect.consentSnapshot;
  attributionSnapshot: typeof analyticsConversionDeliveries.$inferSelect.attributionSnapshot;
  userDataSnapshot: typeof analyticsConversionDeliveries.$inferSelect.userDataSnapshot;
  requestId: string | null;
  acceptedAt: Date | null;
  attemptCount: number;
  leaseToken: string;
  work: "ingest" | "poll";
}>;

type ClaimInput = Readonly<{
  platform: ConversionPlatform;
  now: Date;
  leaseToken: string;
  leaseDurationMs: number;
}>;

type LeaseMutation = Readonly<{
  id: string;
  leaseToken: string;
  now: Date;
}>;

type FailureMutation = LeaseMutation & Readonly<{
  errorCode: string;
  errorCategory: ConversionErrorCategory;
  diagnostics?: ConversionProviderDiagnostics;
}>;

function leaseWhere(input: Pick<LeaseMutation, "id" | "leaseToken">) {
  return and(
    eq(analyticsConversionDeliveries.id, input.id),
    eq(analyticsConversionDeliveries.status, "sending"),
    eq(analyticsConversionDeliveries.leaseToken, input.leaseToken),
  );
}

function released(values: Record<string, unknown>) {
  return {
    ...values,
    leaseToken: null,
    leaseExpiresAt: null,
  };
}

export function createDrizzleConversionDeliveryRepository(database: Database) {
  return Object.freeze({
    async claimNext(input: ClaimInput): Promise<ClaimedConversionDelivery | null> {
      if (!Number.isSafeInteger(input.leaseDurationMs) || input.leaseDurationMs < 1_000) {
        throw new Error("Invalid conversion delivery lease");
      }
      return database.transaction(async (transaction) => {
        const [row] = await transaction.select()
          .from(analyticsConversionDeliveries)
          .where(and(
            eq(analyticsConversionDeliveries.platform, input.platform),
            inArray(analyticsConversionDeliveries.status, [
              "pending", "accepted", "processing", "retryable_failed",
            ]),
            lte(analyticsConversionDeliveries.nextAttemptAt, input.now),
          ))
          .orderBy(
            asc(analyticsConversionDeliveries.nextAttemptAt),
            asc(analyticsConversionDeliveries.createdAt),
            asc(analyticsConversionDeliveries.id),
          )
          .for("update", { skipLocked: true })
          .limit(1);
        if (!row) return null;
        const leaseExpiresAt = new Date(input.now.getTime() + input.leaseDurationMs);
        const attemptCount = row.attemptCount + 1;
        const [updated] = await transaction.update(analyticsConversionDeliveries).set({
          status: "sending",
          attemptCount,
          lastAttemptAt: input.now,
          leaseToken: input.leaseToken,
          leaseExpiresAt,
          updatedAt: input.now,
        }).where(and(
          eq(analyticsConversionDeliveries.id, row.id),
          eq(analyticsConversionDeliveries.attemptCount, row.attemptCount),
          eq(analyticsConversionDeliveries.status, row.status),
        )).returning({ id: analyticsConversionDeliveries.id });
        if (!updated) return null;
        return Object.freeze({
          id: row.id,
          platform: row.platform,
          transactionId: row.transactionId,
          jobId: row.jobId,
          eventType: row.eventType,
          eventOccurredAt: row.eventOccurredAt,
          eventSource: row.eventSource,
          currency: row.currency,
          valueMinor: row.valueMinor,
          consentSnapshot: row.consentSnapshot,
          attributionSnapshot: row.attributionSnapshot,
          userDataSnapshot: row.userDataSnapshot,
          requestId: row.requestId,
          acceptedAt: row.acceptedAt,
          attemptCount,
          leaseToken: input.leaseToken,
          work: row.requestId ? "poll" as const : "ingest" as const,
        });
      });
    },

    async recoverStaleClaims(now: Date): Promise<number> {
      const rows = await database.update(analyticsConversionDeliveries).set({
        status: sql`case when ${analyticsConversionDeliveries.requestId} is null then 'pending' else 'accepted' end`,
        nextAttemptAt: now,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: now,
      }).where(and(
        eq(analyticsConversionDeliveries.status, "sending"),
        lte(analyticsConversionDeliveries.leaseExpiresAt, now),
      )).returning({ id: analyticsConversionDeliveries.id });
      return rows.length;
    },

    async markAccepted(input: LeaseMutation & Readonly<{ requestId: string; nextAttemptAt: Date }>) {
      const [row] = await database.update(analyticsConversionDeliveries).set(released({
        status: "accepted",
        requestId: input.requestId,
        acceptedAt: input.now,
        nextAttemptAt: input.nextAttemptAt,
        lastErrorCode: null,
        lastErrorCategory: null,
        lastErrorAt: null,
        updatedAt: input.now,
      })).where(and(
        leaseWhere(input),
        eq(analyticsConversionDeliveries.platform, "google"),
      )).returning({ id: analyticsConversionDeliveries.id });
      return Boolean(row);
    },

    async markProcessing(input: LeaseMutation & Readonly<{
      nextAttemptAt: Date;
      diagnostics?: ConversionProviderDiagnostics;
    }>) {
      const [row] = await database.update(analyticsConversionDeliveries).set(released({
        status: "processing",
        nextAttemptAt: input.nextAttemptAt,
        ...(input.diagnostics ? { providerDiagnostics: input.diagnostics } : {}),
        updatedAt: input.now,
      })).where(and(
        leaseWhere(input),
        isNotNull(analyticsConversionDeliveries.requestId),
      )).returning({ id: analyticsConversionDeliveries.id });
      return Boolean(row);
    },

    async markSucceeded(input: LeaseMutation & Readonly<{
      diagnostics?: ConversionProviderDiagnostics;
    }>) {
      const [row] = await database.update(analyticsConversionDeliveries).set(released({
        status: "succeeded",
        completedAt: input.now,
        nextAttemptAt: input.now,
        lastErrorCode: null,
        lastErrorCategory: null,
        lastErrorAt: null,
        ...(input.diagnostics ? { providerDiagnostics: input.diagnostics } : {}),
        updatedAt: input.now,
      })).where(leaseWhere(input)).returning({ id: analyticsConversionDeliveries.id });
      return Boolean(row);
    },

    async markRetryableFailed(input: FailureMutation & Readonly<{ nextAttemptAt: Date }>) {
      const [row] = await database.update(analyticsConversionDeliveries).set(released({
        status: "retryable_failed",
        nextAttemptAt: input.nextAttemptAt,
        lastErrorCode: input.errorCode,
        lastErrorCategory: input.errorCategory,
        lastErrorAt: input.now,
        ...(input.diagnostics ? { providerDiagnostics: input.diagnostics } : {}),
        updatedAt: input.now,
      })).where(leaseWhere(input)).returning({ id: analyticsConversionDeliveries.id });
      return Boolean(row);
    },

    async markPermanentFailed(input: FailureMutation) {
      const [row] = await database.update(analyticsConversionDeliveries).set(released({
        status: "permanent_failed",
        completedAt: input.now,
        lastErrorCode: input.errorCode,
        lastErrorCategory: input.errorCategory,
        lastErrorAt: input.now,
        ...(input.diagnostics ? { providerDiagnostics: input.diagnostics } : {}),
        updatedAt: input.now,
      })).where(leaseWhere(input)).returning({ id: analyticsConversionDeliveries.id });
      return Boolean(row);
    },

    async markDeadLetter(input: FailureMutation) {
      const [row] = await database.update(analyticsConversionDeliveries).set(released({
        status: "dead_letter",
        completedAt: input.now,
        deadLetteredAt: input.now,
        lastErrorCode: input.errorCode,
        lastErrorCategory: input.errorCategory,
        lastErrorAt: input.now,
        ...(input.diagnostics ? { providerDiagnostics: input.diagnostics } : {}),
        updatedAt: input.now,
      })).where(leaseWhere(input)).returning({ id: analyticsConversionDeliveries.id });
      return Boolean(row);
    },

    async redactExpiredSnapshots(now: Date) {
      const succeededBefore = new Date(now.getTime() - 90 * 24 * 60 * 60_000);
      const failedBefore = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
      const rows = await database.update(analyticsConversionDeliveries).set({
        consentSnapshot: redactedSnapshot,
        attributionSnapshot: redactedSnapshot,
        userDataSnapshot: redactedSnapshot,
        updatedAt: now,
      }).where(and(
        or(
          and(
            eq(analyticsConversionDeliveries.status, "succeeded"),
            lte(analyticsConversionDeliveries.completedAt, succeededBefore),
          ),
          and(
            inArray(analyticsConversionDeliveries.status, ["permanent_failed", "dead_letter"]),
            lte(analyticsConversionDeliveries.completedAt, failedBefore),
          ),
        ),
        sql`${analyticsConversionDeliveries.consentSnapshot} ->> 'redacted' is distinct from 'true'`,
      )).returning({ id: analyticsConversionDeliveries.id });
      return rows.length;
    },
  });
}
