# Production Drift Guardrails Implementation Plan

> Execute in the isolated `governance/production-drift-guardrails` worktree. `origin/main` is the only release baseline. Do not deploy or make platform writes before the review gate.

**Goal:** Make a normal non-`main` Production build fail, and make Git/Vercel/domain/environment/migration drift detectable through one read-only command and scheduled CI.

**Architecture:** Strengthen the existing prebuild source guard, add one dependency-injected read-only Production audit CLI backed by Vercel REST metadata and the existing migration-lineage verifier, and add a disposable PostgreSQL release-test runner. Keep platform changes separate from repository changes.

**Tech stack:** TypeScript, Vitest, Node.js `fetch`/`child_process`, PostgreSQL (`pg`), GitHub Actions, existing Drizzle lineage helpers.

---

### Task 1: Strengthen the existing Production source guard

**Files:**
- Modify: `scripts/verify-production-deployment-source.ts`
- Modify: `scripts/production-deployment-guard.test.ts`

1. Add a failing test for the required two-line failure message.
2. Preserve local, Preview, CI and Git-backed `main` behavior.
3. Implement the exact fail-closed message and rerun the focused test.

### Task 2: Add the single read-only Production guard

**Files:**
- Create: `scripts/production-guard.ts`
- Create: `scripts/production-guard.test.ts`
- Modify: `package.json`

1. Add failing tests for SHA/branch/project/domain/alias/history/env-duplicate/env-scope drift.
2. Implement pure invariant evaluation with credential-free findings.
3. Implement read-only Git and Vercel adapters; never print environment values.
4. Reuse the existing read-only migration-lineage verifier when its dedicated audit credentials are present; fail closed when required audit inputs are absent.
5. Wire `npm run production:guard` and verify non-zero exit on drift.

### Task 3: Add disposable release-test database orchestration

**Files:**
- Create: `scripts/release-test-database.ts`
- Create: `scripts/release-test-database.test.ts`
- Modify: database integration tests that hard-code one shared database name
- Modify: two stale Analytics attribution assertions exposed by the complete baseline run
- Modify: `package.json`

1. Add failing tests for deterministic test naming, Production identity rejection, command ordering and cleanup after failure.
2. Create a unique `rnr_gallery_test_release_gate_<sha>_<suffix>` database from an explicit admin URL.
3. Prove the target differs from every supplied Production fingerprint before creation/use.
4. Apply current migrations, run the complete suite, and always terminate/drop in `finally`.
5. Expose one release-test command without changing ordinary developer tests.

### Task 4: Add CI and permanent governance documentation

**Files:**
- Create: `.github/workflows/production-guard.yml`
- Modify: `AGENTS.md`
- Modify: `README.md`

1. Run the read-only guard on pushes to `main`, manual dispatch, and weekly schedule.
2. Reference only GitHub Actions secrets; do not add or reveal credentials.
3. Document isolated worktree/session databases and the normal release flow.
4. Preserve all existing governance rules.

### Task 5: Verification and review gate

1. Run focused guard and release-database tests.
2. Run the complete executable test suite, typecheck, lint, `db:check`, build and `git diff --check`.
3. Run `production:guard` only if all read-only credentials are available; otherwise prove its fail-closed behavior and report the missing secret names.
4. Inspect the final diff for governance-only scope.
5. Re-fetch `origin/main`, reconcile semantically, and provide the pre-deployment report. Do not merge or deploy in this phase.
