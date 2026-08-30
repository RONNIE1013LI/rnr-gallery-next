import { pathToFileURL } from "node:url";
import { Pool } from "pg";

export const LEGACY_LEARNING_PLACEHOLDER = "Review this repeated edit pattern before changing the approved guidance.";
export const LEARNING_PLACEHOLDER_REMEDIATION_REASON = "Superseded during the audited placeholder-candidate remediation; no guidance was approved.";

type PlaceholderRow = Readonly<{
  id: string;
  candidate_kind: string;
  proposed_change: string;
  reason_codes: unknown;
  status: string;
  approved_text: string | null;
  reviewer_user_id: string | null;
  decision_reason: string | null;
}>;

function parseIds(raw: string | undefined) {
  const ids = [...new Set((raw ?? "").split(",").map((value) => value.trim()).filter(Boolean))];
  if (ids.length !== 4 || ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
    throw new Error("learning_candidate_remediation_exact_four_ids_required");
  }
  return ids;
}

export function classifyPlaceholderRemediationState(
  rows: readonly PlaceholderRow[],
  expectedIds: readonly string[],
  reviewerUserId: string,
) {
  if (rows.length !== 4 || new Set(rows.map((row) => row.id)).size !== 4
    || expectedIds.some((id) => !rows.some((row) => row.id === id))) {
    throw new Error("learning_candidate_remediation_row_identity_mismatch");
  }
  const hasExactLegacyContent = (row: PlaceholderRow) => row.candidate_kind === "answer_quality_rule"
    && row.proposed_change === LEGACY_LEARNING_PLACEHOLDER
    && JSON.stringify(row.reason_codes) === JSON.stringify(["independent_human_reply"])
    && row.approved_text === null;
  if (rows.every((row) => hasExactLegacyContent(row) && row.status === "pending"
    && row.reviewer_user_id === null && row.decision_reason === null)) return "apply" as const;
  if (rows.every((row) => hasExactLegacyContent(row) && row.status === "superseded"
    && row.reviewer_user_id === reviewerUserId
    && row.decision_reason === LEARNING_PLACEHOLDER_REMEDIATION_REASON)) return "already_applied" as const;
  throw new Error("learning_candidate_remediation_state_mismatch");
}

async function main() {
  if (process.env.LEARNING_CANDIDATE_REMEDIATION_CONFIRM !== "SUPERSEDE_EXACTLY_FOUR") {
    throw new Error("learning_candidate_remediation_confirmation_required");
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const reviewerUserId = process.env.LEARNING_CANDIDATE_REMEDIATION_REVIEWER_USER_ID?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!reviewerUserId) throw new Error("learning_candidate_remediation_reviewer_required");
  const ids = parseIds(process.env.LEARNING_CANDIDATE_REMEDIATION_IDS);
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const result = await remediateLearningCandidatePlaceholders(pool, { ids, reviewerUserId });
    process.stdout.write(`learning_candidate_placeholder_remediation=PASS transitioned=${result.transitioned} already_applied=${result.alreadyApplied}\n`);
  } finally {
    await pool.end();
  }
}

export async function remediateLearningCandidatePlaceholders(
  pool: Pick<Pool, "connect">,
  input: Readonly<{ ids: readonly string[]; reviewerUserId: string }>,
) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const selected = await client.query<PlaceholderRow>(
      `select id::text, candidate_kind, proposed_change, reason_codes, status, approved_text,
              reviewer_user_id, decision_reason
         from customer_service_learning_candidates
        where id = any($1::uuid[])
        order by id
        for update`,
      [input.ids],
    );
    const state = classifyPlaceholderRemediationState(selected.rows, input.ids, input.reviewerUserId);
    if (state === "already_applied") {
      await client.query("commit");
      return { transitioned: 0, alreadyApplied: 4 } as const;
    }
    const updated = await client.query(
      `update customer_service_learning_candidates
          set status = 'superseded', approved_text = null, reviewer_user_id = $2,
              decision_reason = $3, decided_at = now(), updated_at = now()
        where id = any($1::uuid[])
          and status = 'pending'
          and candidate_kind = 'answer_quality_rule'
          and proposed_change = $4
          and reason_codes = '["independent_human_reply"]'::jsonb
          and approved_text is null
          and reviewer_user_id is null
          and decided_at is null
        returning id`,
      [input.ids, input.reviewerUserId, LEARNING_PLACEHOLDER_REMEDIATION_REASON, LEGACY_LEARNING_PLACEHOLDER],
    );
    if (updated.rowCount !== 4) throw new Error("learning_candidate_remediation_cas_mismatch");
    await client.query("commit");
    return { transitioned: 4, alreadyApplied: 0 } as const;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "learning_candidate_remediation_failed"}\n`);
    process.exitCode = 1;
  });
}
