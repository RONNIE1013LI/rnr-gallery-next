# Final Launch Security Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the Production application over to a restricted database runtime identity and establish a verified encrypted incremental Vercel Blob backup on the authorised Time Capsule without Production downtime.

**Architecture:** Keep the existing database owner identity for explicit migration/admin/recovery work while granting a new runtime login only CRUD/sequence/function access and default future-object privileges. Back up Vercel Blob objects locally with AES-256-GCM, encrypted manifests, content-addressed incremental storage, fail-closed classification, atomic completion, and privacy-aware private-object reconciliation.

**Tech Stack:** TypeScript, Node.js crypto/fs streams, PostgreSQL 17, `pg`, Drizzle, `@vercel/blob`, Vitest, zsh, macOS Keychain, launchd, Vercel CLI.

**Spec:** `docs/superpowers/specs/2026-08-27-final-launch-security-remediation-design.md`

## Global constraints

- Do not generate, edit, or execute a formal migration.
- Do not expose credentials or customer data in code, output, logs, manifests, or reports.
- Do not transfer existing database ownership or delete the privileged identity.
- Do not change DNS, domains, payment/auth configuration, business logic, pricing, or UI.
- Do not use `vercel --prod`; Production must deploy automatically from `origin/main`.
- Stop and roll back immediately on critical Production regression.

---

### Task 1: Add deterministic encrypted backup primitives

**Files:**
- Create: `scripts/blob-backup/crypto.ts`
- Create: `scripts/blob-backup/types.ts`
- Create: `scripts/blob-backup/manifest.ts`
- Create: `scripts/blob-backup/crypto.test.ts`
- Create: `scripts/blob-backup/manifest.test.ts`

- [ ] Write RED tests for AES-256-GCM round-trip, wrong-key/tamper rejection, authenticated metadata, version rejection, deterministic SHA-256 identities, manifest validation, PII-field rejection, and strict `gallery`/`private` classification.
- [ ] Run focused tests and confirm RED because modules do not exist.
- [ ] Implement the minimum versioned encryption envelope and manifest validators.
- [ ] Run focused tests to GREEN and `git diff --check`.
- [ ] Self-review for key/nonce reuse, unauthenticated metadata, unsafe paths, and accidental secret logging.

### Task 2: Add incremental, atomic backup and retention reconciliation

**Files:**
- Create: `scripts/blob-backup/filesystem.ts`
- Create: `scripts/blob-backup/backup-engine.ts`
- Create: `scripts/blob-backup/backup-engine.test.ts`

- [ ] Write RED tests proving unchanged objects are not rewritten, changed objects create a new content-addressed encrypted object, interrupted runs remain `.partial`, only verified runs receive `COMPLETE`, resume is retry-safe, unknown prefixes fail closed, Gallery history persists, private history does not persist, and removed private source objects purge unreferenced encrypted backup objects.
- [ ] Run focused tests and confirm RED.
- [ ] Implement filesystem abstraction, staging/atomic completion, encrypted Gallery/current-private manifests, fsync/read-back verification, and private-object garbage collection.
- [ ] Run focused tests to GREEN.
- [ ] Add a failure-injection test for network/share interruption followed by successful retry.

### Task 3: Add Production Blob inventory, backup, restore, and Keychain wrappers

**Files:**
- Create: `scripts/backup-production-blob.ts`
- Create: `scripts/restore-production-blob-backup.ts`
- Create: `scripts/blob-backup/vercel-source.ts`
- Create: `scripts/blob-backup/vercel-source.test.ts`
- Create: `ops/macos/run-production-blob-backup.zsh`
- Create: `ops/macos/install-production-blob-backup-launch-agent.zsh`
- Create: `ops/macos/com.rnr.production-blob-backup.plist.template`
- Modify: `ops/macos/README.md`
- Modify: `package.json`

- [ ] Write RED tests for paginated Blob listing, bounded private metadata, private source classification, no URL/token in output, restore checksum/size/content-type verification, and owner-only temporary handling.
- [ ] Run focused tests and confirm RED.
- [ ] Implement Production Blob source adapter and CLI commands.
- [ ] Implement Keychain-only wrappers and daily LaunchAgent installation; keep all values out of argv, environment files, repo, and logs.
- [ ] Run focused tests, shell syntax checks, and lint/typecheck.

### Task 4: Add repeatable database runtime-role security tooling

**Files:**
- Create: `scripts/database-runtime-role-security.ts`
- Create: `scripts/database-runtime-role-security.test.ts`
- Modify: `package.json`
- Modify: `ops/macos/README.md`

- [ ] Write RED tests for safe role-name validation, least-privilege SQL generation, default privileges, forbidden DDL probes, safe summaries, and refusal when database identity or role ownership assumptions differ.
- [ ] Run focused tests and confirm RED.
- [ ] Implement inventory, rehearsal, apply, verify, and rollback-script generation modes without printing connection strings or credentials.
- [ ] Ensure apply mode requires explicit Production confirmation, expected database, expected host fingerprint, and Keychain credential retrieval.
- [ ] Run focused tests to GREEN.

### Task 5: Rehearse the final database role model in isolation

**Interfaces:**
- Disposable isolated PostgreSQL database.
- Existing guarded complete migration runner under privileged/migration identity.
- Restricted role from Task 4.

- [ ] Create a disposable isolated database and prove its identity is not Production.
- [ ] Replay the complete current migration chain using the privileged identity.
- [ ] Create the restricted role and verify role attributes, ownership, current grants, future default grants, and forbidden operations.
- [ ] Run application read/write, order, payment-ledger, file metadata, admin, webhook, idempotency, notification, cleanup/background, sequence, and function tests as the restricted role.
- [ ] Create a new object as migration identity and verify default privileges permit only the intended runtime operations.
- [ ] Drop the disposable database/roles and retain only sanitized counts/results.

### Task 6: Establish Keychain entries and pass the Time Capsule health gate

**External state:**
- macOS Keychain generic-password entries.
- `/Volumes/Data/RNR Gallery Backups`.

- [ ] Create/verify a random 256-bit Blob backup encryption key in Keychain.
- [ ] Store/verify the existing Production privileged DB recovery credential in Keychain without exposing it.
- [ ] Confirm the share mount identity and free space.
- [ ] Execute write, fsync, close, reopen, full read-back, checksum, encryption/decryption, interruption, retry, and partial-not-COMPLETE tests in an isolated health-check directory.
- [ ] Remove health-check artifacts and report only sanitized PASS/status evidence.

### Task 7: Execute real Blob backup and restore drills

- [ ] Inventory Production Blob counts/bytes/categories without paths, URLs, or customer metadata in logs.
- [ ] Run the initial encrypted incremental backup to Time Capsule.
- [ ] Run it again and prove unchanged objects are not duplicated.
- [ ] Restore one real non-sensitive Gallery asset into an isolated local directory and prove checksum, size, and content type match.
- [ ] Create a synthetic private Blob object, back it up, restore it privately, verify checksum/privacy, remove its source, rerun reconciliation, and prove the private backup copy is purged.
- [ ] Delete the synthetic source and restore artifacts; verify no public URL or plaintext backup remains.
- [ ] Install/verify the daily LaunchAgent and failure visibility.

### Task 8: Prepare and perform the Production database credential cutover

**External state:**
- Production PostgreSQL roles/grants/default privileges.
- Vercel Production environment variables.

- [ ] Fetch latest `origin/main` and stop on drift or unexpected worktree overlap.
- [ ] Pull Production environment metadata/values into an owner-only temporary directory; enumerate every DB-capable variable without displaying values.
- [ ] Record the current safe database identity, current role state, known-good deployment, and an executable secret-free rollback procedure.
- [ ] Create and verify the restricted Production role/grants/default privileges using the privileged Keychain credential.
- [ ] Reconcile every Production DB-capable Vercel variable so the runtime has no privileged bypass; remove unused credential fragments and retain no privileged URL in Production runtime.
- [ ] Verify Production Branch remains `main`, remove all temporary secret material, and trigger a fresh Git-main deployment by the normal release path only after code verification/review.
- [ ] If any critical regression occurs, immediately restore the previous environment configuration and known-good deployment; do not roll back schema/data.

### Task 9: Final verification and independent security review

- [ ] Run `npm ci` if dependency state requires it.
- [ ] Run focused DB-role, Blob-backup, Meta webhook, security-preservation, and relevant application tests.
- [ ] Run the full test suite using an isolated Test DB.
- [ ] Run TypeScript, full ESLint, Drizzle/schema check, Production build, Preview build, and `git diff --check`.
- [ ] Review DB blast radius, ownership, default privileges, Keychain isolation, manifest privacy, encryption, retention, restore integrity, schedule failure behavior, and rollback readiness independently from implementation.
- [ ] Fetch latest `origin/main`, reconcile semantic changes, rerun targeted tests/typecheck/build, and commit/push only the reviewed feature scope.

### Task 10: Merge, deploy, and execute the Final Launch Gate

- [ ] Record `origin/main` before SHA and ensure fast-forward/approved merge without force.
- [ ] Merge/push to `origin/main`; let Vercel Git integration deploy automatically.
- [ ] Verify the READY Production deployment uses `githubCommitRef=main`, the exact `origin/main` SHA, and both Production aliases.
- [ ] Smoke public, admin, order, form, review, auth, upload, checkout-load, Stripe/Afterpay safe initialization, webhook, WAF, robots, redirect, and image paths without real orders or charges.
- [ ] Inspect the short post-cutover error window for database permission, background, webhook, notification, and customer-facing failures.
- [ ] Confirm Keychain entries, scheduled backup, current encrypted backup, retention reconciliation, and rollback artifact remain available.
- [ ] Produce the required Final Launch Security Report and stop.
