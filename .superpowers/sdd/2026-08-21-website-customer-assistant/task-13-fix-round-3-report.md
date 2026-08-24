# Task 13 Fix Round 3 Report

## Scope

- Branch: `feat/website-customer-assistant`
- Starting commit: `641f83ba708ee41a10f6c99db385e5d388d465c2`
- Findings closed: I1 additive alert linearization, I2 durable crash/recovery, M1 indexed opaque selector lookup
- This remains Task 13. No Task 14, Facebook send behavior, production configuration, or deployment work was added.
- The final commit SHA is returned in the handoff because a commit cannot contain its own SHA.

## Fixes

### Additive alert linearization and recovery

- Removed the undeployed `sending` status design from schema, DTOs, migration 0050, and repository state transitions.
- Retained the original five-state outbox CHECKs and added only nullable `provider_send_started_at` metadata.
- Provider-send linearization now CASes the active `leased` row by setting that timestamp under the shared conversation advisory lock; the transaction ends before the network call.
- Manual resolution terminalizes pending, retry-wait, and not-yet-linearized leases. A durably linearized lease is left for deterministic worker settlement or lease-expiry recovery.
- Expired linearized leases are reclaimed with a new lease token and the same persisted provider idempotency key. Known provider failures clear the attempt's linearization timestamp before retry.
- Expired linearized rows whose review was resolved, or whose deep link expired, settle explicitly to `failed` and are not sent again.
- Conversation-first lock ordering is now also used by alert claim/recovery. Two recovery workers serialize safely; terminal rows remain unclaimable.

### Indexed opaque selectors

- Added `customer_service_review_selectors`, containing only a SHA-256 selector digest, server-side review foreign key, generation, and expiry.
- Daily deterministic HMAC selectors remain opaque, canonical, renewable, bounded to 30 days, and stable within the issuance window.
- Queue, polling, and authorized deep-link loading idempotently issue the current selector row. Day-31 refresh remains answerable while the prior window remains expired.
- Manual reply hashes the submitted opaque selector and performs one unique-index candidate lookup, then re-verifies the canonical HMAC, generation, expiry, Website channel constraint, review state, and conversation lock.
- The browser DTO and POST still contain no review UUID, conversation ID, session ID, or PSID.

### Migration 0050 replacement

- Replaced `0050_sticky_mysterio.sql` with generated `0050_furry_human_torch.sql` and regenerated snapshot metadata.
- Migration 0050 contains one `CREATE TABLE`, one `ADD COLUMN`, one foreign key, and three indexes. It contains no `DROP`, removal, or constraint replacement.
- The migration guard now reads 0044, 0049, and 0050 and rejects any `DROP`, `ALTER TABLE ... DROP`, `TRUNCATE`, or `DELETE FROM` statement.
- Journal entry 50 follows entry 49 at timestamp `1787385600001`; generated snapshot and journal are coherent.

## RED Evidence

- Additive migration guard: 1 failed, 6 passed. It failed on the two `DROP CONSTRAINT` statements in the old 0050.
- Expanded schema contract: 3 failed, 4 passed. The selector table and send-start column did not exist and old 0050 still removed constraints.
- Indexed selector repository regression with 250 historical open reviews: 1 failed, 131 skipped. It observed zero selector-table lookups because the repository loaded Website review history.
- Durable recovery repository/service regressions: 4 failed, 132 skipped. Rows became `sending`; pre-provider crash, provider-accepted settlement failure, resolved expiry, and two-worker recovery were all unrecoverable.

## GREEN Evidence

- Focused selector/deep-link/history database cases: 3/3 passed.
- Focused crash/recovery database and service cases: 4/4 passed.
- Final migration guard: 7/7 passed.
- Manual resolution after lease expiry regression: 1/1 passed.
- Full repository integration, serial: 136/136 passed in 345.81 seconds, zero skipped.
- Website session, public-update, and Website schema integration, serial: 14/14 passed, zero skipped.
- Customer Service schema database suite, serial: 26/26 passed, zero skipped, including the three conditionally enabled PostgreSQL cases.
- Full Customer Service and Reply Assistant non-integration surface: 73 files, 836 passed. Its three database-only cases were then run in the zero-skip 26/26 database command above.
- `npm run typecheck`, `npm run lint -- --quiet`, `npm run db:check`, and `git diff --check` passed.
- Direct migration and diff scans found no removal SQL, Meta page token, Graph/Messenger send, or OpenAI send capability in this change.

## Fresh Migration Replay

- Created a genuinely isolated dedicated test database named `rnr_task13_round3_test_20260822_032932` from the approved test server; no production database was touched.
- The safety-checked migration runner replayed all 51 migrations successfully with no pre-existing schema or ledger.
- Direct verification found 51 Drizzle journal rows, latest journal timestamp `1787385600001`, the selector table, and `provider_send_started_at`.
- Direct constraint inspection confirmed only `pending`, `leased`, `retry_wait`, `sent`, and `failed`; leased remains the sole status permitted to hold lease metadata.

## Files

- `drizzle/0050_furry_human_torch.sql`
- `drizzle/0050_sticky_mysterio.sql` (replaced/deleted)
- `drizzle/meta/0050_snapshot.json`
- `drizzle/meta/_journal.json`
- `src/server/db/schema/customer-service.ts`
- `src/server/db/schema/website-customer-service-schema.test.ts`
- `src/server/customer-service/website/review-selector.ts`
- `src/server/customer-service/repositories/customer-service-repository.ts`
- `src/server/customer-service/repositories/drizzle-customer-service-repository.ts`
- `src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts`
- `src/components/reply-assistant/reply-assistant-client.tsx`
- `.superpowers/sdd/2026-08-21-website-customer-assistant/task-13-fix-round-3-report.md`

## Bounded Ruling

- Unknown provider outcomes remain terminal under the previously approved Task 10-12 policy. Round 3 adds recovery only for durable process/settlement crashes where retrying the same provider idempotency key is the safe reconciliation path.
- Expired selector rows store only hashes and server-side metadata. Cleanup/retention automation is outside Task 13 and is not required for correctness or browser privacy.
