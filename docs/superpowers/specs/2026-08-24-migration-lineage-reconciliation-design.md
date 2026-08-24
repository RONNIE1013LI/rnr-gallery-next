# Migration Lineage Reconciliation Design

**Status:** Reconciled in Test; Production migration pending
**Date:** 2026-08-24  
**Branch:** `chore/migration-lineage-reconciliation`  
**Base:** `feat/internal-notifications-market-switch` at `f6f0980f959d460d8ea1f35531624e37000bb78d`

## Goal

Make the repository migration lineage an exact, reproducible continuation of the 54 migrations already recorded in Production, then place the approved internal-notification schema migration after that history. The result must make an ordinary guarded migration command fail closed on any lineage mismatch and apply only the new notification schema when run against Production.

## Current verified state

Read-only Production inspection established:

- Database: `neondb`, PostgreSQL 17.11, not in recovery.
- `drizzle.__drizzle_migrations` contains 54 rows.
- `origin/main` contains only 37 journal entries.
- Production and `origin/main` agree through Production migration ID 35 (`0034_admin_staff_access`).
- Production migration IDs 36–54 come from migration files that exist on current Git branches but are not represented canonically on `origin/main`.
- Production has 71 public tables; the current `0036` snapshot has 51.
- The 20 additional Production tables are customer-service and historical-order migration tables.
- Four existing tables have additional Production columns, including `production_jobs.legacy_source` and `production_jobs.legacy_order_id`.
- The three internal-notification tables do not yet exist in Production.
- The approved notification SQL hash is not present in Production migration history.

No Production write, migration, deployment, merge, or push occurred during this inspection.

## Test reconciliation evidence

- The immutable Production prefix matches the repository lineage exactly: 54 of 54 entries.
- A fresh guarded Test replay passed, and the Production/Test baseline catalog comparison reported zero differences.
- The reconciled baseline contains 71 tables, 957 columns, 266 indexes, 547 constraints, no enums, and one application sequence.
- The earlier 953-column snapshot count omitted four columns already applied by exact migration `0038_facebook_customer_display_names`; the corrected `0055` snapshot contains 957 columns.
- Migration position 55 is `0056_internal_notification_center`; it adds only the three approved notification tables, with zero changes to existing baseline objects.
- The complete Test lineage contains 74 tables and 994 columns. A guarded rerun added zero migration rows and left the catalog unchanged.
- Production migration remains pending. No Production write or migration occurred during reconciliation.

## Source of truth

The reconciliation uses this precedence order:

1. Production `drizzle.__drizzle_migrations`, read only: applied order, SHA-256 hash, and timestamp.
2. The exact Git SQL blob whose SHA-256 equals each Production hash.
3. Production catalog metadata, read only: tables, columns, indexes, constraints, enums, sequences, and foreign keys.
4. The current application schema.

File names and branch names are discovery metadata only. They cannot override a Production hash.

## Considered approaches

### A. Rebuild the repository lineage as the exact Production prefix — selected

Create a canonical local journal whose first 54 entries match Production in order, hash, and timestamp. Reuse the exact matching SQL bytes. Use the existing post-migration snapshot as the base only after it is proven equivalent to the Production catalog. Generate the internal-notification migration as the next entry, `0056_internal_notification_center`.

This preserves immutable applied history, makes future migrations deterministic, and allows a permanent exact-prefix safety gate.

### B. Run the current `0037` SQL manually — rejected

This could create the three tables, but it would leave the repository and Production ledger divergent. Future ordinary Drizzle migrations would remain unsafe.

### C. Squash Production into a new baseline — rejected

This would require rewriting or replacing published migration history. It is unnecessary and conflicts with the requirement to preserve auditable applied hashes.

## Canonical Production prefix

The local journal must reproduce these applied groups exactly:

| Production IDs | Canonical migration files |
| --- | --- |
| 1–35 | Existing `0000_overjoyed_spyke` through `0034_admin_staff_access` |
| 36 | `0035_bright_praxagora` |
| 37 | `0035_needy_lorna_dane` |
| 38–40 | `0035_reply_assistant_live_updates`, `0036_reply_assistant_live_update_reliability`, `0037_reply_assistant_image_cleanup_live_update` |
| 41 | `0036_empty_smiling_tiger` |
| 42 | `0038_facebook_customer_display_names` |
| 43–54 | `0044_website_customer_assistant` through `0055_order_number_sequence_floor_sync` |

Each entry must use the exact SQL content that produced the corresponding Production hash. Unapplied branch-only migrations must not be inserted into the canonical prefix merely because their timestamps or numeric names appear earlier.

## Repository changes

### Application schema restoration

The reconciled `0055` snapshot and a fresh Drizzle generation must be compared before the notification migration is accepted. If the generator proposes dropping or altering Production-applied objects because their TypeScript schema definitions never reached `main`, restore those definitions from the exact reviewed Git branch that produced the applied migration. This restoration changes application metadata only; it must not emit a new migration for objects already present in Production.

The restoration must cover every Production-applied table, column, constraint, index, enum, and sequence represented by `0055`. It must preserve the current notification schema and must not copy unrelated runtime/service implementation from historical branches.

### Migration artifacts

- Add the missing exact-hash SQL files required by Production IDs 36–54.
- Rewrite `drizzle/meta/_journal.json` so its first 54 entries are a one-to-one ordered representation of Production.
- Replace the misleading intermediate snapshot lineage with a canonical latest applied snapshot only after catalog equivalence is proven.
- Remove the current notification entry from position `0037` without changing its SQL semantics.
- Generate `0056_internal_notification_center.sql` and its snapshot after the reconciled latest snapshot.
- The `0056` SQL may create or index only:
  - `internal_notification_recipients`
  - `internal_notification_subscriptions`
  - `internal_notification_outbox`
- It must not alter an existing Production table.

Drizzle derives a generated numeric prefix from journal position, not the highest historical tag. If it generates a collision such as `0054_internal_notification_center`, retain the generated SQL and snapshot bytes only after semantic review, restore the applied `0054` snapshot, rename the new artifacts to `0056`, and set the journal tag/timestamp to the approved values. This metadata normalization must pass Drizzle check, full replay, and exact-prefix tests; it must never edit generated SQL to conceal schema drift.

### Permanent safety gate

Before `drizzle-kit migrate` runs, the migration wrapper must:

1. Read the target database migration rows in ascending ID order.
2. Hash the local journal SQL files using SHA-256.
3. Require every applied database row to equal the local entry at the same position by hash and timestamp.
4. Reject an applied database history longer than the local journal.
5. Reject missing SQL files, duplicate journal indexes, duplicate timestamps, or ambiguous hash mappings.
6. Print only safe identifiers; never print connection strings, credentials, or raw environment values.

The check applies to Test and Production migrations. Production still additionally requires the existing explicit confirmation, expected database name, and expected host fingerprint.

### Release policy

The temporary migration freeze in `AGENTS.md` may be replaced only after:

- all 54 Production rows are an exact prefix of the repository journal;
- the reconciled applied snapshot matches the read-only Production catalog;
- a fresh Test DB can replay the complete lineage;
- the safety gate rejects intentionally divergent histories;
- independent review approves the reconciliation.

The replacement policy must continue to require exact-prefix reconciliation before every Production migration. It must not weaken the main-only Production deployment guard.

## Production catalog reconciliation

The verifier compares the applied snapshot with read-only Production metadata for:

- public tables and columns;
- column data types, nullability, and defaults;
- primary, unique, check, and foreign-key constraints;
- indexes;
- enums and enum values;
- sequences and ownership where represented by the application schema.

Any unexplained difference is blocking. Runtime data, row counts, grants, extension-owned objects, and provider-managed metadata are reported separately and do not get silently written into application migrations.

## Test strategy

### Unit tests

The migration safety tests must prove:

- an empty database history is a valid prefix;
- the exact Production-style prefix is accepted;
- a changed hash is rejected;
- an out-of-order hash is rejected;
- a timestamp mismatch is rejected;
- a database history longer than the local journal is rejected;
- duplicate journal indexes or timestamps are rejected;
- failure occurs before `drizzle-kit migrate` is spawned.

Every behavior test follows RED → GREEN.

### Isolated database verification

Using a new dedicated loopback Test DB:

1. Replay the complete canonical lineage from zero.
2. Confirm the first 54 stored migration hashes and timestamps equal the read-only Production inventory.
3. Confirm migration 55 is the new `0056` notification migration.
4. Confirm only the three approved notification tables are added over the applied Production-equivalent snapshot.
5. Run migration a second time and confirm no schema or migration-row change.
6. Run application schema, notification, migration-safety, typecheck, lint, Drizzle check, and build verification.

### Production preflight

Before any Production write:

- fetch and recheck authoritative `origin/main`;
- require the release worktree to be clean;
- pull Production environment values only into an owner-only temporary directory;
- run the exact-prefix and catalog checks read only;
- delete the temporary environment file;
- stop if any value differs from the approved reconciliation record.

## Deployment sequence after reconciliation PASS

The already approved release proceeds only in this order:

1. Fast-forward the reconciled release branch to `origin/main` without using the dirty main worktree.
2. Push normally; never force-push.
3. Execute the guarded Production migration with explicit database identity arguments.
4. Verify Production migration history has exactly one new row and the three notification tables exist.
5. Allow the Vercel Git integration to deploy `main`; do not run `vercel --prod`.
6. Verify READY deployment SHA equals `origin/main`, `githubCommitRef` is `main`, and both Production domains are assigned.
7. Smoke-test market switching, Admin notification settings, public verification safety, `/`, `/shop`, and `/order-system`.

No real test email is sent during deployment verification.

## Fail-closed conditions

Stop before Production mutation if any of the following occurs:

- a Production migration hash has no exact Git SQL match;
- more than one non-identical SQL blob claims the same ledger position;
- the Production migration order or timestamp differs from the canonical journal;
- the Production catalog differs from the reconciled applied snapshot without an explicit explanation;
- the fresh Test DB cannot replay from zero;
- `0056` changes an existing table;
- the worktree is dirty or `origin/main` moved;
- the Vercel deployment source is not Git `main` with the exact pushed SHA.

## Non-goals

- No rewrite or deletion of Production migration records.
- No change to historical order data, sequence values, payment data, customer data, or notification recipients.
- No real email delivery test.
- No force-push, manual Production promotion, DNS change, or unrelated worktree cleanup.
