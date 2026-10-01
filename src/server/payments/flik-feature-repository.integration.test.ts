import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDrizzleFlikFeatureRepository, verifyFlikMigrationCatalog, type FlikFeatureMutation } from "./flik-feature-repository";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");
const target = new URL(url);
if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || target.pathname !== "/rnr_gallery_test_flik_feature") {
  throw new Error("Feature persistence tests require their own disposable local database");
}
const pool = new Pool({ connectionString: url });
const database = drizzle(pool);
const repository = createDrizzleFlikFeatureRepository(database);
const actor = { userId: `feature-test-${randomUUID()}`, email: `feature-${randomUUID()}@example.test` };
const mutation = (): FlikFeatureMutation => ({ actor, status: "internal_verification", expectedStatus: "disabled", idempotencyKey: randomUUID() });
beforeAll(async () => {
  await pool.query(`INSERT INTO "user" (id,name,email,role) VALUES ($1,'Feature test',$2,'admin')`, [actor.userId, actor.email]);
});
beforeEach(async () => {
  await pool.query("DELETE FROM content_entries WHERE key='payments.flik.status'");
  await pool.query("DELETE FROM admin_audit_logs WHERE actor_user_id=$1", [actor.userId]);
});
afterAll(() => pool.end());

describe("private Flik feature state against disposable PostgreSQL without Flik migration", () => {
  it("reads disabled with no state row and rejects migration readiness with no Flik tables", async () => {
    await expect(repository.readState()).resolves.toBe("disabled");
    await expect(repository.migrationReady()).resolves.toBe(false);
    expect((await pool.query("SELECT to_regclass('public.flik_checkout_sessions') AS sessions,to_regclass('public.flik_webhook_events') AS events")).rows[0]).toEqual({ sessions: null, events: null });
  });
  it("atomically persists one state and one audit under eight identical concurrent submissions", async () => {
    const input = mutation();
    await expect(Promise.all(Array.from({ length: 8 }, () => repository.setState(input)))).resolves.toEqual(Array(8).fill("internal_verification"));
    await expect(repository.readState()).resolves.toBe("internal_verification");
    const audits = await pool.query("SELECT before_summary,after_summary FROM admin_audit_logs WHERE actor_user_id=$1", [actor.userId]);
    expect(audits.rows).toEqual([{ before_summary: { status: "disabled" }, after_summary: { status: "internal_verification", liveVerificationConfirmed: false } }]);
  });
  it("allows one competing optimistic change and refuses the stale submission", async () => {
    const input = mutation();
    const outcomes = await Promise.allSettled([
      repository.setState(input), repository.setState({ ...input, idempotencyKey: randomUUID() }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect((await pool.query("SELECT count(*)::int AS count FROM admin_audit_logs WHERE actor_user_id=$1", [actor.userId])).rows[0].count).toBe(1);
  });
  it("rejects altered idempotent payload and preserves the existing state", async () => {
    const input = mutation();
    await repository.setState(input);
    await expect(repository.setState({ ...input, status: "live", expectedStatus: "internal_verification", liveVerificationConfirmed: true })).rejects.toThrow();
    await expect(repository.readState()).resolves.toBe("internal_verification");
  });
  it("requires the internal stage and records the explicit live confirmation", async () => {
    const input = mutation();
    await expect(repository.setState({ ...input, status: "live", liveVerificationConfirmed: true })).rejects.toThrow();
    await repository.setState(input);
    await expect(repository.setState({ ...input, idempotencyKey: randomUUID(), status: "live", expectedStatus: "internal_verification" })).rejects.toThrow();
    await repository.setState({ ...input, idempotencyKey: randomUUID(), status: "live", expectedStatus: "internal_verification", liveVerificationConfirmed: true });
    await expect(repository.readState()).resolves.toBe("live");
    const { rows } = await pool.query("SELECT after_summary FROM admin_audit_logs WHERE actor_user_id=$1 AND after_summary->>'status'='live'", [actor.userId]);
    expect(rows).toEqual([{ after_summary: { status: "live", liveVerificationConfirmed: true } }]);
  });
  it("rolls back an invalid actor without leaving a feature row or audit", async () => {
    await expect(repository.setState({ ...mutation(), actor: { ...actor, userId: "missing-actor" } })).rejects.toThrow();
    expect((await pool.query("SELECT count(*)::int AS count FROM content_entries WHERE key='payments.flik.status'")).rows[0].count).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS count FROM admin_audit_logs WHERE resource_id='payments.flik.status'")).rows[0].count).toBe(0);
  });
  it("does not treat missing applied journal or missing schema as ready", async () => {
    await expect(verifyFlikMigrationCatalog(database, { tag: "0071_flik_checkout", when: 1790000000000 })).resolves.toBe(false);
  });
});
