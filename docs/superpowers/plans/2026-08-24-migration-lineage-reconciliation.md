# Migration Lineage Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the repository migration history as the exact 54-row Production prefix, add permanent fail-closed lineage verification, and regenerate the approved internal-notification migration as canonical entry `0056`.

**Architecture:** Preserve every applied Production SQL blob byte-for-byte and reconstruct only repository metadata around that immutable history. A reusable lineage module verifies database rows against local journal hashes before any migration process starts. A catalog reader compares a fresh 54-migration replay with Production read-only metadata, after which the notification schema becomes the sole 55th migration.

**Tech Stack:** TypeScript, Node.js, PostgreSQL 17, `pg`, Drizzle ORM/Kit, Vitest, Docker.

**Spec:** `docs/superpowers/specs/2026-08-24-migration-lineage-reconciliation-design.md`

## Global Constraints

- Production `drizzle.__drizzle_migrations` order, SHA-256 hash, and timestamp are the immutable migration-history source of truth.
- Never rewrite Production migration rows or the bytes of an applied SQL migration.
- The canonical first 54 local entries must equal Production one-to-one.
- The notification migration must be `0056_internal_notification_center` and may create only the three approved notification tables and their constraints/indexes.
- A lineage mismatch must fail before `drizzle-kit migrate` is spawned.
- Production catalog inspection is read only and must not expose connection strings, credentials, or environment values.
- Use only dedicated loopback Test DBs for replay and mutation testing.
- Do not touch the dirty main worktree or unrelated worktrees.
- Do not force-push, run `vercel --prod`, manually promote a deployment, send a real email, or change DNS/payment/auth configuration.
- Production migration and deployment may resume only after every task and final review pass.

---

### Task 1: Reconstruct the immutable 54-entry Production prefix

**Files:**
- Create: `drizzle/meta/production-lineage-2026-08-24.json`
- Create: `scripts/migration-lineage-artifacts.test.ts`
- Add exact applied SQL files under: `drizzle/`
- Add reconciled snapshots under: `drizzle/meta/`
- Modify: `drizzle/meta/_journal.json`
- Delete: `drizzle/0037_internal_notification_center.sql`
- Delete: `drizzle/meta/0037_snapshot.json`

**Interfaces:**
- Consumes: the read-only 54-row Production ledger and exact matching Git SQL blobs.
- Produces: a local journal whose complete current history is the immutable 54-row Production prefix, plus a latest applied `0055_snapshot.json` for Tasks 3–4.

- [ ] **Step 1: Capture the sanitized Production ledger**

Pull Production environment values to an owner-only temporary directory. Query only:

```sql
BEGIN READ ONLY;
SELECT id, hash, created_at
FROM drizzle.__drizzle_migrations
ORDER BY id;
ROLLBACK;
```

Write only `id`, full lowercase `hash`, and decimal-string `createdAt` to `drizzle/meta/production-lineage-2026-08-24.json`. Delete the temporary environment file immediately. Assert there are exactly 54 rows and IDs are 1–54.

- [ ] **Step 2: Write the failing artifact contract test**

The test must load the immutable manifest, `_journal.json`, and SQL bytes. It must assert:

```ts
expect(journal.entries).toHaveLength(54);
expect(manifest).toHaveLength(54);
expect(new Set(journal.entries.map((entry) => entry.idx)).size).toBe(54);
expect(new Set(journal.entries.map((entry) => String(entry.when))).size).toBe(54);

for (const [index, applied] of manifest.entries()) {
  const entry = journal.entries[index];
  expect(entry.idx).toBe(index);
  expect(String(entry.when)).toBe(applied.createdAt);
  expect(sha256(readFileSync(`drizzle/${entry.tag}.sql`))).toBe(applied.hash);
}
```

It must also assert the latest snapshot contains 71 public tables and that no notification table exists yet.

- [ ] **Step 3: Run RED**

Run:

```bash
npm run test:run -- scripts/migration-lineage-artifacts.test.ts
```

Expected: FAIL because the local journal has 38 entries, the Production manifest does not exist, and the notification migration occupies the wrong position.

- [ ] **Step 4: Restore exact applied SQL artifacts**

Recover each SQL file by exact Git blob and verify its SHA-256 against the manifest before staging it. The required tail is:

```text
0035_bright_praxagora
0035_needy_lorna_dane
0035_reply_assistant_live_updates
0036_reply_assistant_live_update_reliability
0037_reply_assistant_image_cleanup_live_update
0036_empty_smiling_tiger
0038_facebook_customer_display_names
0044_website_customer_assistant
0045_website_product_context
0046_dizzy_scarlet_witch
0047_slim_morlun
0048_empty_bloodaxe
0049_website_review_live_updates
0050_furry_human_torch
0051_dusty_annihilus
0052_next_human_robot
0053_ambiguous_otto_octavius
0054_order_system_historical_migration
0055_order_number_sequence_floor_sync
```

Use these discovery refs only to retrieve a blob whose hash matches the manifest:

```text
0035_bright_praxagora                         release/reply-assistant-durable-recovery-2026-08-19
0035_needy_lorna_dane                         data/order-system-migration
0035_reply_assistant_live_updates             data/order-system-migration
0036_reply_assistant_live_update_reliability  data/order-system-migration
0037_reply_assistant_image_cleanup_live_update data/order-system-migration
0036_empty_smiling_tiger                      data/order-system-migration
0038_facebook_customer_display_names          feat/reply-assistant-facebook-display-names
0044_website_customer_assistant..0055_order_number_sequence_floor_sync
                                                data/order-system-migration
```

Do not add unapplied `turn_recovery` or `turn_recovery_correction` migrations.

- [ ] **Step 5: Rebuild the journal and applied snapshot lineage**

Use sequential journal indexes `0..53`, with each `when` copied from the Production manifest and each tag mapped to the exact matching SQL hash. Restore the reconciled post-`0055` snapshot from the reviewed migration branch, then prove its public table/column set matches the 71-table Production inventory. Remove the premature notification SQL/snapshot.

- [ ] **Step 6: Run GREEN and Drizzle validation**

Run:

```bash
npm run test:run -- scripts/migration-lineage-artifacts.test.ts
npm run db:check
git diff --check
```

Expected: PASS.

- [ ] **Step 7: Self-review and commit**

Confirm every restored SQL hash equals the immutable manifest and the diff contains no SQL-content edits to already-applied blobs. Commit:

```bash
git add drizzle scripts/migration-lineage-artifacts.test.ts
git commit -m "fix: reconcile production migration lineage"
```

---

### Task 2: Add an exact-prefix migration execution guard

**Files:**
- Create: `scripts/migration-lineage.ts`
- Create: `scripts/migration-lineage.test.ts`
- Modify: `scripts/migrate-database.ts`
- Modify: `scripts/migrate-database.test.ts`

**Interfaces:**
- Consumes: canonical journal and local SQL files from Task 1; applied database rows `{ id, hash, createdAt }`.
- Produces: `readLocalMigrationLineage(rootDir)`, `readAppliedMigrationLineage(connectionString)`, and `assertAppliedMigrationPrefix(applied, local)`; `runMigration` invokes the assertion before spawning Drizzle.

- [ ] **Step 1: Write RED tests for the pure prefix contract**

Use literal fixtures and assert:

```ts
expect(() => assertAppliedMigrationPrefix([], local)).not.toThrow();
expect(() => assertAppliedMigrationPrefix(local.slice(0, 2), local)).not.toThrow();
expect(() => assertAppliedMigrationPrefix(changedHash, local)).toThrow(/hash mismatch/i);
expect(() => assertAppliedMigrationPrefix(changedTimestamp, local)).toThrow(/timestamp mismatch/i);
expect(() => assertAppliedMigrationPrefix(reordered, local)).toThrow(/mismatch/i);
expect(() => assertAppliedMigrationPrefix(tooLong, local)).toThrow(/longer/i);
```

Add local-loader cases for missing SQL, duplicate indexes, duplicate timestamps, and uppercase/non-64-character hashes.

- [ ] **Step 2: Run RED**

```bash
npm run test:run -- scripts/migration-lineage.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimal lineage module**

Define immutable types:

```ts
export type MigrationLineageEntry = Readonly<{
  position: number;
  hash: string;
  createdAt: string;
  tag?: string;
}>;
```

`readLocalMigrationLineage` must parse `_journal.json`, validate structure, hash each referenced SQL file with SHA-256, and return ordered entries. `readAppliedMigrationLineage` must use a read-only transaction with a bounded statement timeout and return safe values only. `assertAppliedMigrationPrefix` must compare position, hash, and timestamp exactly.

- [ ] **Step 4: Run GREEN**

```bash
npm run test:run -- scripts/migration-lineage.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write RED migration-wrapper tests**

Extend `runMigration` dependency injection with `verifyLineage`. Prove call order and fail-closed behavior:

```ts
expect(events).toEqual(["identify", "verify-lineage", "write-identity", "run-drizzle"]);
expect(runDrizzle).not.toHaveBeenCalled(); // when lineage verification rejects
```

- [ ] **Step 6: Run RED**

```bash
npm run test:run -- scripts/migrate-database.test.ts
```

Expected: FAIL because migration execution does not yet verify lineage.

- [ ] **Step 7: Wire the guard before Drizzle spawn**

After database identity passes, load the local lineage and database lineage, call `assertAppliedMigrationPrefix`, and only then print the safe identity and call `runDrizzle`. Never print URL/user/password values.

- [ ] **Step 8: Run GREEN and regressions**

```bash
npm run test:run -- scripts/migration-lineage.test.ts scripts/migrate-database.test.ts scripts/migration-safety.test.ts
npm run typecheck
npm run lint
```

Expected: PASS with zero lint errors.

- [ ] **Step 9: Self-review and commit**

```bash
git add scripts/migration-lineage.ts scripts/migration-lineage.test.ts scripts/migrate-database.ts scripts/migrate-database.test.ts
git commit -m "feat: guard migration lineage before execution"
```

---

### Task 3: Restore Production-applied application schema definitions

**Files:**
- Modify: `src/server/db/schema/customer-service.ts`
- Modify: `src/server/db/schema/customer-service-schema.test.ts`
- Create: `src/server/db/schema/order-system-migration.ts`
- Create: `src/server/db/schema/order-system-migration-schema.test.ts`
- Modify: `src/server/db/schema/orders.ts`
- Modify: `src/server/db/schema/production.ts`
- Modify: `src/server/db/schema/production-schema.test.ts`
- Modify: `src/server/db/schema/index.ts`

**Interfaces:**
- Consumes: exact reviewed schema definitions from `data/order-system-migration` that produced the canonical `0055_snapshot.json`.
- Produces: current TypeScript schema metadata containing all 71 Production-applied public tables, 953 columns, represented constraints/indexes, and the applied order-number sequence definition, while retaining the three notification table definitions for Task 4.

- [ ] **Step 1: Write RED schema-presence tests**

Add literal assertions for the 20 missing table names, the four changed-table column sets, the `production_jobs` legacy constraints/index, and the applied sequence options. Tests must import real Drizzle table objects and inspect their configuration; they must not grep source text.

- [ ] **Step 2: Run RED**

```bash
npm run test:run -- \
  src/server/db/schema/customer-service-schema.test.ts \
  src/server/db/schema/order-system-migration-schema.test.ts \
  src/server/db/schema/production-schema.test.ts
```

Expected: FAIL because the 20 tables and applied schema details are not currently exported.

- [ ] **Step 3: Restore only the reviewed schema metadata**

Use `data/order-system-migration` as the reviewed source for `customer-service.ts`, `order-system-migration.ts`, the applied portions of `orders.ts` and `production.ts`, and their focused tests. Merge `index.ts` so both the restored schema and current `internal-notifications` exports remain present. Do not copy runtime services, routes, jobs, migration commands, or unrelated application behavior.

- [ ] **Step 4: Run GREEN and regression tests**

```bash
npm run test:run -- \
  src/server/db/schema/customer-service-schema.test.ts \
  src/server/db/schema/order-system-migration-schema.test.ts \
  src/server/db/schema/production-schema.test.ts \
  src/server/db/schema/internal-notifications-schema.test.ts
npm run typecheck
npm run lint
git diff --check
```

Expected: PASS with zero lint errors.

- [ ] **Step 5: Self-review and commit**

Confirm the diff is limited to schema metadata/tests and retains current internal-notification exports. Commit:

```bash
git add src/server/db/schema
git commit -m "fix: restore production applied schema definitions"
```

---

### Task 4: Regenerate internal notifications as canonical migration 0056

**Files:**
- Create: `drizzle/0056_internal_notification_center.sql`
- Create: `drizzle/meta/0056_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Modify: `scripts/migration-lineage-artifacts.test.ts`
- Modify: `src/server/db/schema/internal-notifications-schema.test.ts`

**Interfaces:**
- Consumes: canonical `0055_snapshot.json` and current application schema.
- Produces: journal entry index 54, timestamp `1787525686969`, tag `0056_internal_notification_center`; this is the only migration after the immutable Production prefix.

- [ ] **Step 1: Extend artifact tests and verify RED**

Require 55 total local entries, preserve exact manifest matching for entries 0–53, and assert entry 54 has the approved tag/timestamp. Compare `0055` and `0056` snapshots so exactly three tables are added and every pre-existing table is deeply equal.

Run:

```bash
npm run test:run -- scripts/migration-lineage-artifacts.test.ts src/server/db/schema/internal-notifications-schema.test.ts
```

Expected: FAIL because `0056` does not exist.

- [ ] **Step 2: Generate from the canonical latest snapshot**

Run:

```bash
npm run db:generate -- --name internal_notification_center
```

If Drizzle proposes any existing-table alteration, stop and report the exact objects instead of editing generated SQL to hide drift.

Because Drizzle names by journal position, it may initially create `0054_internal_notification_center.sql` and overwrite the tracked `0054_snapshot.json`. In that case: preserve the generated candidate bytes, restore the applied `0054_snapshot.json` from HEAD, move the candidate SQL/snapshot to `0056_internal_notification_center.sql` and `0056_snapshot.json`, then set journal entry index 54 to tag `0056_internal_notification_center` and timestamp `1787525686969`. Do not change the generated SQL body.

- [ ] **Step 3: Inspect generated SQL semantically**

Allow only CREATE/ALTER FK/index/check operations whose targets are:

```text
internal_notification_recipients
internal_notification_subscriptions
internal_notification_outbox
```

Confirm no `ALTER TABLE` targets a pre-existing table.

- [ ] **Step 4: Run GREEN**

```bash
npm run test:run -- scripts/migration-lineage-artifacts.test.ts src/server/db/schema/internal-notifications-schema.test.ts
npm run db:check
git diff --check
```

Expected: PASS.

- [ ] **Step 5: Self-review and commit**

```bash
git add drizzle scripts/migration-lineage-artifacts.test.ts src/server/db/schema/internal-notifications-schema.test.ts
git commit -m "feat: append notification schema to canonical lineage"
```

---

### Task 5: Prove fresh replay and Production catalog equivalence

**Files:**
- Create: `scripts/schema-catalog.ts`
- Create: `scripts/schema-catalog.test.ts`
- Create: `scripts/verify-migration-lineage.ts`
- Create: `scripts/verify-migration-lineage.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: canonical lineage from Tasks 1–4 and two database URLs supplied only at runtime.
- Produces: a safe JSON reconciliation summary containing database name, applied count, matching prefix count, catalog object counts, differences, and no credentials.

- [ ] **Step 1: Write RED catalog-normalization tests**

Use literal catalog fixtures. Prove deterministic sorting and detection of added, removed, or changed tables, columns, indexes, constraints, enums, and sequences. A default/type/nullability change must be reported at its exact object path.

- [ ] **Step 2: Run RED**

```bash
npm run test:run -- scripts/schema-catalog.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement catalog reading and comparison**

Use read-only `pg_catalog`/`information_schema` queries. Return normalized, sorted values for:

```ts
type SchemaCatalog = Readonly<{
  tables: readonly TableDefinition[];
  indexes: readonly IndexDefinition[];
  constraints: readonly ConstraintDefinition[];
  enums: readonly EnumDefinition[];
  sequences: readonly SequenceDefinition[];
}>;
```

Exclude only `drizzle.__drizzle_migrations`, extension-owned objects, privileges, row data, and current sequence values. Do not exclude application-owned public objects.

- [ ] **Step 4: Write RED verifier tests**

Inject database identity, applied-lineage reader, and catalog reader. Prove the verifier:

- accepts exact 54-row prefix plus equal catalogs;
- rejects a lineage difference before catalog approval;
- rejects any catalog difference with exact object paths;
- emits no supplied URL or password in success/error output.

- [ ] **Step 5: Implement the read-only CLI**

Add:

```json
"db:lineage:check": "tsx scripts/verify-migration-lineage.ts"
```

Require explicit environment, expected database, and expected host fingerprint using the existing migration-safety parser conventions. Support `--compare-test-catalog`; when present it requires both `PRODUCTION_DATABASE_URL` and `TEST_DATABASE_URL`, verifies Production identity and lineage, then compares the two read-only catalogs. The command must never call Drizzle migrate.

- [ ] **Step 6: Run unit GREEN**

```bash
npm run test:run -- scripts/schema-catalog.test.ts scripts/verify-migration-lineage.test.ts scripts/migration-lineage.test.ts
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Replay the first 54 entries into a new dedicated Test DB**

Create container `rnr-migration-lineage-test` on loopback port `55450` with database `rnr_migration_lineage_test`. Use a temporary migration folder containing the canonical first 54 entries, run the guarded migration, and confirm stored hashes/timestamps equal the immutable Production manifest.

- [ ] **Step 8: Compare Test baseline with Production read only**

Pull Production environment values to an owner-only temporary directory. Supply Production as `PRODUCTION_DATABASE_URL` and the baseline clone as `TEST_DATABASE_URL`, then run:

```bash
npm run db:lineage:check -- \
  --environment production \
  --confirm-production \
  --expected-database neondb \
  --expected-host-fingerprint baa43ddcddcac5530101232bdf74cd8f649aa60f2276c7dbd95214b3c4d2d304 \
  --compare-test-catalog
```

Expected: 54/54 exact prefix and zero catalog differences. Delete the temporary environment file immediately.

- [ ] **Step 9: Apply entry 55 only in Test and verify idempotency**

Run the full guarded test migration. Assert:

- applied migration count becomes 55;
- the new hash equals `0056_internal_notification_center.sql`;
- exactly the three notification tables are added;
- a second run leaves count and catalog unchanged.

- [ ] **Step 10: Self-review and commit**

```bash
git add scripts/schema-catalog.ts scripts/schema-catalog.test.ts scripts/verify-migration-lineage.ts scripts/verify-migration-lineage.test.ts package.json package-lock.json
git commit -m "test: verify migration replay against production lineage"
```

---

### Task 6: Close the migration freeze and run release gates

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-08-24-migration-lineage-reconciliation-design.md`

**Interfaces:**
- Consumes: clean independent reviews and exact reconciliation output from Tasks 1–5.
- Produces: a repository policy requiring the permanent lineage check before Production migrations and a release-ready reconciliation record.

- [ ] **Step 1: Verify the freeze exit conditions**

Require recorded evidence for:

```text
Production prefix: 54/54 exact
Production/Test baseline catalog differences: 0
Fresh replay: PASS
Notification migration position: 55
Notification-only added tables: 3
Rerun migration-row delta: 0
```

If any value differs, do not change `AGENTS.md`.

- [ ] **Step 2: Update the policy narrowly**

Replace only the temporary freeze sentence with a permanent rule equivalent to:

```text
Before every Production migration, run the exact-prefix lineage and database-identity checks. Any hash, order, timestamp, catalog, or identity mismatch blocks migration; never bypass or rewrite applied history.
```

Keep every main-only deployment and explicit Production-approval rule unchanged.

- [ ] **Step 3: Mark the design reconciliation status**

Update the design status to `Reconciled in Test; Production migration pending` and record only safe counts/hashes, never secrets or hostnames.

- [ ] **Step 4: Run the complete release verification**

Run:

```bash
npm run test:run
npm run typecheck
npm run lint
npm run db:check
npm run build
git diff --check
```

Also run all dedicated database suites against their approved isolated Test DBs. If the known unchanged Forms fixture fails, independently reproduce the same failure on authoritative `origin/main` and report it separately; no new branch-caused failure is allowed.

- [ ] **Step 5: Verify cleanup and isolation**

Confirm:

- reconciliation Test DB fixture rows are zero or the disposable container is stopped;
- no listener created by this plan remains;
- temporary Production environment files are absent;
- the reconciliation worktree is clean;
- the dirty main worktree and unrelated worktrees are unchanged.

- [ ] **Step 6: Self-review and commit**

```bash
git add AGENTS.md docs/superpowers/specs/2026-08-24-migration-lineage-reconciliation-design.md
git commit -m "docs: close reconciled migration freeze"
```

- [ ] **Step 7: Whole-branch review**

Review from `f6f0980f959d460d8ea1f35531624e37000bb78d` through HEAD with strict attention to immutable SQL hashes, journal ordering, catalog equivalence, fail-closed execution, secret handling, and Production isolation. All Critical and Important findings must be fixed and re-reviewed before integration.

---

## Post-plan authorized release sequence

After all six tasks and whole-branch review are approved, continue the user's already-approved release without another routine approval prompt:

1. Fetch `origin --prune` and stop on drift.
2. Fast-forward push the clean reconciled HEAD to `origin/main`; never force-push.
3. Pull Production environment into an owner-only temporary directory.
4. Run read-only lineage/catalog preflight.
5. Execute the guarded Production migration with the approved database identity.
6. Verify exactly one new migration row and exactly three new notification tables.
7. Remove the temporary Production environment file.
8. Wait for the Git `main` Vercel deployment and verify READY SHA/ref/domains.
9. Run the approved Production smoke checks without sending real email.

Stop only for destructive/security-sensitive new findings, origin drift, failed reconciliation, failed migration, or deployment-source mismatch.
