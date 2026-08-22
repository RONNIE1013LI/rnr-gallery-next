# Task 13 Fix Round 5 Report

## Scope

- Branch: `feat/website-customer-assistant`
- Starting commit: `1d60b38ca1407736590cc0f9be14c5e851b5b31a`
- Findings closed: I1 dedicated review-link secret and I2 immutable provider payload recovery.
- No Task 14, Facebook behavior, production configuration, deployment, or non-additive migration work was added.

## Fixes

- Added required server-only `REPLY_ASSISTANT_REVIEW_LINK_SECRET`. Website mode fails closed when it is absent, shorter than 32 characters, or reused as the session/abuse key.
- Review creation and email delivery now use only the dedicated link key. Rotating `CUSTOMER_CHAT_SESSION_SECRET` changes selectors/sessions but cannot change a pending or recovered alert token or its stored SHA-256 hash.
- Documented the simple safe rotation boundary: keep the dedicated key stable while alerts or seven-day links remain valid; pause and drain alerts before rotating it.
- Added canonical SHA-256 provider payload digesting over Resend's exact request identity: `from`, `to` array, subject, text, HTML, and idempotency key. The link and site URL are covered through text/HTML.
- First send linearization atomically stores the original timestamp and digest. Recovery with the same payload reuses both. Mismatch terminalizes before the provider with `provider_payload_config_drift_unknown_result`, preserves both original values, and leaves the human review open.
- Retryable provider errors retain the original timestamp/digest and therefore cannot restart the 23-hour horizon. Resend `invalid_idempotent_request` is terminal/uncertain and never enters ordinary retry.

## RED Evidence

- Dedicated-key config: 2 failed, 33 passed. Missing-key validation and the config field did not exist.
- Secret-domain separation: 1 failed, 35 skipped under the focused filter because session/abuse key reuse was accepted.
- Payload/schema contract: 6 failed. The service omitted the digest, sent after mismatch, retried `invalid_idempotent_request`, and schema/migration 0050 lacked the digest column.

## GREEN Evidence

- Config, alert service, and Website schema contract: 3 files, 57/57 passed.
- Focused PostgreSQL alert/link/recovery regressions: 8/8 passed on the isolated database.
- Full repository integration, serial: 142/142 passed in 372.01 seconds, zero skipped.
- Customer Service schema, Website schema integration, session, and public updates, serial: 4 files, 40/40 passed, zero skipped.
- Full Customer Service and Reply Assistant non-integration surface: 74 files, 843 passed, 3 database-gated cases skipped; those cases passed in the zero-skip database run above.
- `npm run typecheck`, `npm run lint -- --quiet`, `npm run db:check`, and `git diff --check` passed.
- Direct migration, client-secret, database-plaintext, privacy, Meta/Graph/Messenger, and OpenAI no-send scans passed.

## Migration Replay

- Updated undeployed additive `0050_furry_human_torch.sql` with nullable `provider_payload_digest` and a SHA-256-format CHECK. No `DROP`, data rewrite, or constraint weakening was added.
- Regenerated `0050_snapshot.json`; the existing journal remains at entry 50 with no 0051 entry.
- Clean replay used isolated database `rnr_task13_round5_test_20260822_042922` on the approved test server.
- Replay applied 51 ledger rows; the new column and constraint were present, and the latest stored migration hash matched committed 0050.

## Files

- `.env.example`
- `drizzle/0050_furry_human_torch.sql`
- `drizzle/meta/0050_snapshot.json`
- `src/server/customer-service/config.ts`
- `src/server/customer-service/config.test.ts`
- `src/server/customer-service/runtime.ts`
- `src/server/customer-service/website/review-alert-service.ts`
- `src/server/customer-service/website/review-alert-service.test.ts`
- `src/server/customer-service/repositories/customer-service-repository.ts`
- `src/server/customer-service/repositories/drizzle-customer-service-repository.ts`
- `src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts`
- `src/server/db/schema/customer-service.ts`
- `src/server/db/schema/website-customer-service-schema.test.ts`
- `src/server/db/schema/website-customer-service-schema.integration.test.ts`
- `.superpowers/sdd/2026-08-21-website-customer-assistant/task-13-fix-round-5-report.md`

## Bounded Rulings

- No previous-key ring was added. Dedicated review-link key rotation requires a feature pause and drain covering pending alerts and the seven-day deep-link validity period.
- Provider payload drift after a possibly accepted effect is an unknown terminal outcome, not an automatic retry. The outbox becomes failed while the unresolved review remains visible for staff action.
- The fresh replay exposed a stale schema integration fixture that expected removed status `sending` to succeed. It was corrected to assert a valid digest-bearing `leased` row and malformed-digest rejection; production constraints were not changed.
