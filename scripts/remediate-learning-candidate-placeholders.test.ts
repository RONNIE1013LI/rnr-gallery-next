import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { isDedicatedTestDatabase } from "../src/server/db/test-database-safety";
import {
  classifyPlaceholderRemediationState,
  LEARNING_PLACEHOLDER_REMEDIATION_REASON,
  LEGACY_LEARNING_PLACEHOLDER,
  remediateLearningCandidatePlaceholders,
} from "./remediate-learning-candidate-placeholders";

const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
];
const reviewer = "admin-reviewer";
const row = (id: string) => ({
  id,
  candidate_kind: "answer_quality_rule",
  proposed_change: LEGACY_LEARNING_PLACEHOLDER,
  reason_codes: ["independent_human_reply"],
  status: "pending",
  approved_text: null,
  reviewer_user_id: null,
  decision_reason: null,
});

describe("learning candidate placeholder remediation", () => {
  it("permits one exact four-row pending CAS transition", () => {
    expect(classifyPlaceholderRemediationState(ids.map(row), ids, reviewer)).toBe("apply");
  });

  it("is idempotent only for the same completed audited transition", () => {
    expect(classifyPlaceholderRemediationState(ids.map((id) => ({
      ...row(id),
      status: "superseded",
      reviewer_user_id: reviewer,
      decision_reason: LEARNING_PLACEHOLDER_REMEDIATION_REASON,
    })), ids, reviewer)).toBe("already_applied");
  });

  it("fails closed for identity, content or mixed-state drift", () => {
    expect(() => classifyPlaceholderRemediationState(ids.slice(0, 3).map(row), ids, reviewer))
      .toThrow("row_identity_mismatch");
    expect(() => classifyPlaceholderRemediationState(ids.map((id, index) => ({
      ...row(id),
      proposed_change: index === 0 ? "Different guidance" : LEGACY_LEARNING_PLACEHOLDER,
    })), ids, reviewer)).toThrow("state_mismatch");
    expect(() => classifyPlaceholderRemediationState(ids.map((id, index) => ({
      ...row(id),
      status: index === 0 ? "superseded" : "pending",
    })), ids, reviewer)).toThrow("state_mismatch");
  });
});

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationEnabled = Boolean(testDatabaseUrl)
  && isDedicatedTestDatabase(testDatabaseUrl, process.env.DATABASE_URL);
const pool = new Pool({ connectionString: testDatabaseUrl ?? "postgres://disabled.invalid/test", max: 1 });

describe.runIf(integrationEnabled)("learning candidate placeholder remediation transaction", () => {
  beforeEach(async () => {
    await pool.query("delete from customer_service_learning_candidates where id = any($1::uuid[])", [ids]);
    await pool.query('delete from "user" where id = $1', [reviewer]);
    await pool.query(
      `insert into "user" (id, name, email, role)
       values ($1, 'Remediation Reviewer', 'remediation-reviewer@example.test', 'admin')`,
      [reviewer],
    );
    for (const [index, id] of ids.entries()) {
      await pool.query(
        `insert into customer_service_learning_candidates
          (id, candidate_kind, intent, proposed_change, evidence_count, distinct_case_count,
           reason_codes, source_case_memory_ids, evidence_signature, status)
         values ($1, 'answer_quality_rule', 'tone_adjustment', $2, 3, 3,
           '["independent_human_reply"]'::jsonb, '[]'::jsonb, $3, 'pending')`,
        [id, LEGACY_LEARNING_PLACEHOLDER, `legacy-remediation-${index}`],
      );
    }
  });

  afterAll(async () => {
    await pool.query("delete from customer_service_learning_candidates where id = any($1::uuid[])", [ids]);
    await pool.query('delete from "user" where id = $1', [reviewer]);
    await pool.end();
  });

  it("locks and transitions exactly four rows in one audited transaction", async () => {
    await expect(remediateLearningCandidatePlaceholders(pool, { ids, reviewerUserId: reviewer }))
      .resolves.toEqual({ transitioned: 4, alreadyApplied: 0 });
    const result = await pool.query(
      `select status, approved_text, reviewer_user_id, decision_reason
         from customer_service_learning_candidates where id = any($1::uuid[])`,
      [ids],
    );
    expect(result.rows).toHaveLength(4);
    expect(result.rows).toEqual(expect.arrayContaining(Array.from({ length: 4 }, () => expect.objectContaining({
      status: "superseded",
      approved_text: null,
      reviewer_user_id: reviewer,
      decision_reason: LEARNING_PLACEHOLDER_REMEDIATION_REASON,
    }))));
  });

  it("rolls back every row when the audited update cannot complete", async () => {
    await expect(remediateLearningCandidatePlaceholders(pool, {
      ids,
      reviewerUserId: "missing-reviewer",
    })).rejects.toThrow();
    const result = await pool.query(
      "select status, reviewer_user_id from customer_service_learning_candidates where id = any($1::uuid[])",
      [ids],
    );
    expect(result.rows).toEqual(expect.arrayContaining(Array.from({ length: 4 }, () => ({
      status: "pending",
      reviewer_user_id: null,
    }))));
  });
});
