# Phase 3.7 Task 15 Migration Upgrade Fix Report

## Finding Closed

Migration `0053` previously added the validated 24-hour rate-window CHECK immediately. A database upgraded from `0052` could legitimately contain `session_total` rows whose expiry matched the seven-day Website session, so PostgreSQL rejected the migration before the CHECK could be installed.

## RED Evidence

- Added a real isolated upgrade test that replays the repository migration journal through `0052`, inserts a seven-day Website session, its conversation, a legacy seven-day `session_total` bucket, and a compliant 24-hour bucket, then applies the repository `0053`.
- RED failed at the real `ALTER TABLE ... ADD CONSTRAINT` with PostgreSQL `23514`: `customer_service_rate_limit_buckets_window_bounded` was violated by the legacy row.

## Fix

- `0053` now deletes only `customer_service_rate_limit_buckets` rows whose persisted window exceeds 24 hours before adding the validated CHECK.
- The cleanup is intentionally deletion rather than normalization: rate buckets are ephemeral enforcement data with an approved maximum 24-hour retention, and retaining an altered counter/window could produce incorrect rate decisions.
- The migration does not update or delete Website sessions, conversations, reviews, messages, alerts, payment/order records, or other business data.
- No schema-shape change was added beyond the already generated `0053`, so `0053_snapshot.json` remains coherent and unchanged.

## GREEN Evidence

- Focused upgrade/schema: 2 files, 12/12 passed. The test proves the overlong legacy bucket is removed, the compliant bucket survives, the CHECK is validated, the seven-day session and conversation survive, an overlong insert is rejected, and repository Website ingest works after upgrade.
- Fresh one-pass replay through all 54 migrations: PASS.
- Fresh serial Customer Service/Reply Assistant/database suite: 89 files, 1216/1216 tests, zero skips.
- `npm run typecheck`, `npm run lint -- --quiet`, `npm run db:check`, `npm run knowledge:check`, and `git diff --check`: PASS.
- Privacy audit: 11 tables, zero forbidden rows/columns, scope violations, or residual rows.
- No-send/security: 10/10 passed; changed-file provider/no-send and secret scans were clean.
- Fresh migration ledger: 54 rows, latest timestamp `1787385600004`, corrected `0053` SQL hash matched.

## Files

- `drizzle/0053_ambiguous_otto_octavius.sql`
- `src/server/db/schema/website-customer-service-migration-upgrade.integration.test.ts`
- `src/server/db/schema/website-customer-service-schema.test.ts`
