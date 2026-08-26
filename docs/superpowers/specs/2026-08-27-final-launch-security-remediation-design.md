# Final Launch Security Remediation Design

**Status:** Approved for implementation  
**Date:** 2026-08-27  
**Branch:** `security/final-launch-remediation`  
**Base:** `origin/main` at `1bd6a551c42d1b0b546c69dee009a52b76788470`

## Goal

Close the two remaining advertising-readiness blockers without interrupting Production:

1. move the Production application from the existing privileged database identity to a dedicated restricted runtime identity; and
2. create a verified, encrypted, incremental Vercel Blob recovery copy on the authorised AirPort Time Capsule.

This work does not change application business logic or database schema and does not run a formal migration.

## Safety boundaries

- `origin/main` remains the only normal Production source and Vercel Production Branch remains `main`.
- The existing privileged database identity remains available only for migration, administration, and recovery.
- No table ownership transfer, schema migration, migration-journal mutation, DNS change, payment change, or authentication change is included.
- Secrets are stored only in macOS Keychain and are never written to the repository, `.env*`, logs, reports, fixtures, shell history, or client code.
- Production cutover occurs only after isolated role rehearsal, rollback preparation, and backup/restore verification pass.
- A critical Production regression triggers immediate configuration/deployment rollback to the recorded known-good deployment.

## Production database runtime role

### Role model

The existing privileged identity remains the owner/migration identity. A new login role becomes the application runtime identity.

The runtime role receives only:

- database `CONNECT`;
- `USAGE` on the application schema;
- `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on application tables;
- `USAGE` and `SELECT` on application sequences; and
- `EXECUTE` on application functions that the current runtime can invoke.

It must not be superuser and must not have `CREATEROLE`, `CREATEDB`, `REPLICATION`, `BYPASSRLS`, database/schema creation rights, object ownership, or DDL capability.

### Future objects

Default privileges are configured for objects created by the existing migration identity so future tables, sequences, and required functions receive the same minimum runtime grants. No `ALL PRIVILEGES` grant is used.

### Rehearsal and cutover

An isolated database reproduces the final owner/runtime role split. Application read/write, sequence, function, webhook persistence, background cleanup, idempotency, notification, order, payment-ledger, file metadata, and admin paths run under the restricted role. DDL and role/database creation are asserted to fail. The migration identity separately replays the complete migration chain from zero.

Before Production changes, the current role state, safe database identity, old configuration record, rollback SQL, known-good deployment, and exact cutover procedure are recorded without credentials.

The Vercel Production environment is then reconciled so every variable capable of providing a database connection is either removed from the application runtime or points to the restricted identity. The privileged credential remains only in macOS Keychain for explicit migration/admin/recovery use. A new Git-main Production deployment reads the restricted environment.

## Encrypted Blob backup

### Destination and encryption

The authorised destination is:

`/Volumes/Data/RNR Gallery Backups`

Every payload and manifest is encrypted locally before the first write to the Time Capsule using AES-256-GCM with a random nonce and authenticated metadata. The 256-bit key is stored in macOS Keychain. No public backup URL exists.

### Object classes

- `gallery`: business/gallery assets; retained as long-term incremental recovery objects.
- `private`: customer uploads and payment proofs; retained only while the corresponding source object remains active under the approved Production retention policy.

Any unrecognised Production Blob prefix fails closed until explicitly classified.

### Manifest and storage layout

The encrypted manifest records only the technical fields required for restore: source pathname/key, category, byte size, content type, source metadata, SHA-256 checksum, backup timestamp, retention class, and backup object identity. It does not contain customer names, emails, addresses, original file names, order text, payment content, or URLs.

Content-addressed encrypted object files provide incremental behaviour. An unchanged source version is not downloaded and written again after its encrypted object and checksum have been verified. Each run is written to a `.partial` staging area and becomes complete only after every object, encrypted manifest, checksum, fsync, and read-back check passes. A failed/interrupted run never receives a `COMPLETE` marker and can be retried safely.

Gallery manifests may be retained as historical recovery points. Private-object state is a single current encrypted manifest: each successful daily reconciliation removes private backup objects no longer present in the active Production source set. Historical manifests never retain private object references. The maximum operational purge delay is one daily backup interval; the schedule runs after existing retention cleanup jobs.

### Restore

The restore command decrypts one selected object into an isolated local destination and verifies plaintext SHA-256, size, and content type metadata. It never overwrites a Production Blob object. A real non-sensitive Gallery asset and a synthetic private object are used for drills; the synthetic source and restored files are deleted afterward.

### Scheduling and failure visibility

A macOS LaunchAgent runs the backup daily while the Time Capsule is mounted. The wrapper retrieves credentials from Keychain, uses owner-only temporary files where unavoidable, never echoes secrets, and returns non-zero for missing mount, partial run, authentication failure, checksum mismatch, or retention reconciliation failure. Operational logs contain counts and status only. Failed jobs remain visible through LaunchAgent status/logs and do not mark a backup complete.

## Time Capsule health gate

Before relying on the destination, the implementation verifies:

- mounted authorised share and expected path;
- sufficient free space;
- write, fsync, close, reopen, complete read-back, and checksum equality;
- encrypted payload read/decrypt;
- interrupted/partial runs are not marked complete;
- retry/resume succeeds; and
- Gallery and synthetic-private restore drills pass.

The Time Capsule is an independent local recovery copy, not off-site disaster recovery. An off-site encrypted copy remains a non-blocking post-launch improvement.

## Release and rollback

After code/tests/rehearsals pass, the feature branch is reconciled with latest `origin/main`, independently reviewed, and merged normally to `main`. Vercel Git integration creates the Production deployment; `vercel --prod` is not used.

The database credential cutover retains:

- the existing privileged credential in Keychain;
- the pre-cutover Vercel environment inventory;
- rollback commands to restore the prior Production environment scopes; and
- the known-good Production deployment `dpl_88ToQgmmpUnyXMX5qzrAnGtVtHsq`.

If the new deployment reports database permission errors or critical route failures, restore the previous environment configuration and known-good deployment immediately. Database schema and data are not rolled back.

## Verification

Required evidence includes:

- focused DB-role and Blob-backup tests;
- complete isolated migration replay and restricted-runtime suite;
- Gallery and synthetic-private encrypted restore drills;
- Time Capsule fsync/read-back and interruption retry checks;
- full tests, TypeScript, ESLint, Drizzle check, Production and Preview builds, and `git diff --check`;
- independent review of privilege boundaries, secret handling, retention, restore integrity, and rollback; and
- Production smoke for public, admin, order, form, review, upload, auth, Stripe/Afterpay-safe-initiation, webhook, WAF, redirect, and image protection paths.

## Non-goals

- No schema migration or journal change.
- No ownership transfer of existing database objects.
- No removal of the privileged recovery identity.
- No Admin MFA enforcement or full CSP enforcement.
- No unrelated refactor, UI change, payment, authentication, DNS, domain, pricing, order, or customer-data change.
