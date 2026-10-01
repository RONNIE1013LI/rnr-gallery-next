import { and, eq, sql } from "drizzle-orm";
import migrationJournal from "../../../drizzle/meta/_journal.json";
import type { getDatabase } from "@/server/db/client";
import { adminAuditLogs, contentEntries } from "@/server/db/schema/admin";

export type FlikFeatureStatus = "disabled" | "internal_verification" | "live";
export type FlikFeatureMutation = Readonly<{
  status: FlikFeatureStatus;
  expectedStatus: FlikFeatureStatus;
  liveVerificationConfirmed?: boolean;
  actor: Readonly<{ userId: string; email: string }>;
  idempotencyKey: string;
}>;
export interface FlikFeatureRepository {
  readState(): Promise<FlikFeatureStatus>;
  setState(input: FlikFeatureMutation): Promise<FlikFeatureStatus>;
  migrationReady(): Promise<boolean>;
}
export class FlikFeatureConflictError extends Error {
  constructor() { super("Flik settings changed; refresh before trying again"); }
}
export class FlikFeatureValidationError extends Error {
  constructor() { super("Invalid Flik settings update"); }
}

const FEATURE_KEY = "payments.flik.status";
const AUDIT_ACTION = "payments.flik.status.changed";
// Reviewed docs/flik-checkout-migration.sql; moving it into the formal journal must preserve these bytes.
export const FLIK_MIGRATION_SHA256 = "332d9bae18f4f4286756a7889c0d8860ad36e2d7f8fc3ea2710d8ddb7c2042d2";
type Database = ReturnType<typeof getDatabase>;
type JournalEntry = Readonly<{ tag: string; when: number }>;

export function isFlikFeatureStatus(value: unknown): value is FlikFeatureStatus {
  return value === "disabled" || value === "internal_verification" || value === "live";
}
function storedState(entry: Readonly<{ status: string | null }> | undefined): FlikFeatureStatus {
  if (!entry) return "disabled";
  if (!isFlikFeatureStatus(entry.status)) throw new FlikFeatureValidationError();
  return entry.status;
}
export function registeredFlikMigration(entries: readonly JournalEntry[]): JournalEntry | null {
  const registrations = entries.filter((entry) => entry.tag.endsWith("_flik_checkout"));
  if (registrations.length !== 1) return null;
  const entry = registrations[0];
  return Number.isSafeInteger(entry.when) && entry.when > 0 ? entry : null;
}

const REQUIRED_CONSTRAINTS = [
  ["payment_attempts", "payment_attempts_provider_valid"],
  ["payment_attempts", "payment_attempts_method_valid"],
  ["payment_attempts", "payment_attempts_provider_method_valid"],
  ["payment_attempts", "payment_attempts_flik_checkout_only"],
  ["flik_checkout_sessions", "flik_checkout_sessions_target_valid"],
  ["flik_checkout_sessions", "flik_checkout_sessions_nz_only"],
  ["flik_checkout_sessions", "flik_checkout_sessions_amount_valid"],
  ["flik_checkout_sessions", "flik_checkout_sessions_lease_pair"],
  ["flik_checkout_sessions", "flik_checkout_sessions_expected_order_amount_fk"],
  ["flik_checkout_sessions", "flik_checkout_sessions_payment_attempt_id_payment_attempts_id_fk".slice(0, 63)],
  ["flik_webhook_events", "flik_webhook_events_sha256_valid"],
] as const;
const REQUIRED_INDEXES = [
  "flik_checkout_sessions_attempt_unique", "flik_checkout_sessions_provider_reference_unique",
  "flik_checkout_sessions_idempotency_unique", "flik_checkout_sessions_pending_idx", "flik_webhook_events_pending_idx",
] as const;

/** Catalog-only validation. This function never selects from either Flik table.
 * Future activation also requires runtime read access to drizzle.__drizzle_migrations;
 * lacking schema USAGE / table SELECT fails closed. No privileges are changed here.
 */
export async function verifyFlikMigrationCatalog(database: Database, entry: JournalEntry): Promise<boolean> {
  try {
    const constraintPairs = sql.join(REQUIRED_CONSTRAINTS.map(([table, constraint]) => sql`(${table}, ${constraint})`), sql`, `);
    const result = await database.execute<{ ready: boolean }>(sql`
      select (
        exists(select 1 from drizzle.__drizzle_migrations
          where hash = ${FLIK_MIGRATION_SHA256} and created_at = ${entry.when}::bigint)
        and to_regclass('public.flik_checkout_sessions') is not null
        and to_regclass('public.flik_webhook_events') is not null
        and (select count(*) from pg_constraint c
          join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
          where n.nspname = 'public' and c.convalidated and (t.relname, c.conname) in (${constraintPairs})
        ) = ${REQUIRED_CONSTRAINTS.length}
        and (select count(*) from pg_index i
          join pg_class t on t.oid = i.indexrelid join pg_namespace n on n.oid = t.relnamespace
          where n.nspname = 'public' and i.indisvalid and i.indisready
          and t.relname in (${sql.join(REQUIRED_INDEXES.map((name) => sql`${name}`), sql`, `)})
        ) = ${REQUIRED_INDEXES.length}
      ) as ready
    `);
    return result.rows[0]?.ready === true;
  } catch { return false; }
}

export function createDrizzleFlikFeatureRepository(database: Database): FlikFeatureRepository {
  return {
    async readState() {
      const [row] = await database.select({ status: contentEntries.publishedValue }).from(contentEntries)
        .where(eq(contentEntries.key, FEATURE_KEY)).limit(1);
      return storedState(row);
    },
    async setState(input) {
      const liveVerificationConfirmed = input.status === "live" && input.liveVerificationConfirmed === true;
      if (!isFlikFeatureStatus(input.status) || !isFlikFeatureStatus(input.expectedStatus) ||
          (input.liveVerificationConfirmed !== undefined && typeof input.liveVerificationConfirmed !== "boolean") ||
          (input.status === "live" && (!liveVerificationConfirmed || input.expectedStatus !== "internal_verification")) ||
          !input.actor.userId.trim() || !input.actor.email.trim() ||
          input.idempotencyKey.trim().length < 8 || input.idempotencyKey.length > 255) throw new FlikFeatureValidationError();
      return database.transaction(async (transaction) => {
        // Serializes first creation as well as subsequent changes without adding a feature table.
        await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${FEATURE_KEY}, 0))`);
        const [entry] = await transaction.select({ status: contentEntries.publishedValue }).from(contentEntries)
          .where(eq(contentEntries.key, FEATURE_KEY)).for("update").limit(1);
        const current = storedState(entry);
        const [audit] = await transaction.select({ before: adminAuditLogs.beforeSummary, after: adminAuditLogs.afterSummary })
          .from(adminAuditLogs).where(and(eq(adminAuditLogs.actorUserId, input.actor.userId),
            eq(adminAuditLogs.action, AUDIT_ACTION), eq(adminAuditLogs.idempotencyKey, input.idempotencyKey))).limit(1);
        if (audit) {
          if (audit.before?.status !== input.expectedStatus || audit.after?.status !== input.status ||
              (audit.after?.liveVerificationConfirmed === true) !== liveVerificationConfirmed) throw new FlikFeatureConflictError();
          return current;
        }
        if (current !== input.expectedStatus) throw new FlikFeatureConflictError();
        const values = {
          groupName: "Private payment settings", label: "Flik availability", draftValue: input.status,
          publishedValue: input.status, draftUpdatedBy: input.actor.userId, publishedBy: input.actor.userId,
          publishedAt: sql`clock_timestamp()`, updatedAt: sql`clock_timestamp()`,
        };
        await transaction.insert(contentEntries).values({ key: FEATURE_KEY, ...values })
          .onConflictDoUpdate({ target: contentEntries.key, set: values });
        await transaction.insert(adminAuditLogs).values({
          actorUserId: input.actor.userId, actorEmail: input.actor.email,
          action: AUDIT_ACTION, resourceType: "payment_configuration", resourceId: FEATURE_KEY,
          beforeSummary: { status: current }, afterSummary: { status: input.status, liveVerificationConfirmed },
          requestSource: "admin", result: "success", idempotencyKey: input.idempotencyKey,
        });
        return input.status;
      });
    },
    async migrationReady() {
      // A checked-in draft or manually-created table cannot enable payments. The formal
      // bundled journal must contain the explicitly approved migration first.
      const entry = registeredFlikMigration(migrationJournal.entries);
      if (!entry) return false;
      return verifyFlikMigrationCatalog(database, entry);
    },
  };
}
