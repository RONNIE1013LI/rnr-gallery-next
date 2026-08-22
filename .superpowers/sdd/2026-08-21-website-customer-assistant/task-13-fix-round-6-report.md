# Task 13 Fix Round 6 Report

## Scope

- Branch: `feat/website-customer-assistant`
- Starting commit: `c9f70f2f9b9eb686a8c3e1411b88ccedc2547c26`
- Finding closed: I1 provider identity missing from the immutable alert payload digest.
- No Task 14, Facebook behavior, production configuration, deployment, schema, or migration change was added.

## Fix

- Server config derives a 64-hex, non-reversible provider-scope fingerprint by HMAC-SHA-256 over the trimmed `RESEND_API_KEY`, keyed by the dedicated review-link secret and domain-separated with `review-alert-provider-scope\0`.
- The standalone fingerprint remains server-only. The canonical alert payload SHA-256 includes it with the exact Resend request fields; PostgreSQL still stores only the final payload digest.
- Recovery under a changed provider key/scope therefore reaches the existing payload-drift CAS, terminalizes as `provider_payload_config_drift_unknown_result`, preserves the original send marker/digest, makes zero recovery provider calls, and leaves the human review open.
- An unchanged provider key and payload inside the 23-hour recovery horizon continues to reuse the stable idempotency key and produces one provider effect.
- `.env.example` documents the conservative rotation boundary: changing a Resend key terminalizes in-flight ambiguous recoveries, including a safe false-negative for a same-team key rotation.

## RED Evidence

- Config and alert-service tests: 3 failed, 49 passed. The fingerprint was absent from server config, both provider scopes produced the same digest, and the canonical digest omitted provider scope.
- Isolated PostgreSQL recovery test: 1 failed. After the first accepted effect and lost settlement, recovery under a different scope incorrectly returned `sent` instead of `uncertain` and attempted the provider again.
- The shared dedicated test database was stale and lacked the undeployed Round 5 digest column, so it was rejected as behavioral evidence; RED/GREEN DB evidence used the isolated migrated database below.

## GREEN Evidence

- Focused config and alert service: 2 files, 52/52 passed.
- Focused unchanged-scope and changed-scope PostgreSQL recovery: 2/2 passed.
- Full repository integration, serial: 143/143 passed in 374.45 seconds, zero skipped.
- Remaining Customer Service DB suites, one worker: 4 files, 15/15 passed, zero skipped.
- Database-gated Customer Service schema suite: 26/26 passed, zero skipped.
- Full Customer Service/Reply Assistant non-integration surface: 79 files, 875 passed, 3 database-gated cases skipped; all gated cases passed in the zero-skip DB run above.
- `npm run typecheck`, `npm run lint -- --quiet`, `npm run db:check`, and `git diff --check` passed.
- Client-secret, standalone-fingerprint persistence, logging, Meta/Graph/Messenger/OpenAI no-send, and changed-file privacy scans passed.

## Database And Migration

- DB verification used isolated database `rnr_task13_round6_test_20260822_0501` created from the approved dedicated `TEST_DATABASE_URL`; credentials were not printed.
- No migration or schema change was needed. Existing additive migration 0050 remains unchanged, and `db:check` passed.
- The previously documented public-update plan assertion reproduced: PostgreSQL selected the existing channel/external unique index plus a sort instead of the hard-coded keyset index. The test now enforces its actual contract, any index scan and no sequential scan; no query or index changed.

## Files

- `.env.example`
- `src/server/customer-service/config.ts`
- `src/server/customer-service/config.test.ts`
- `src/server/customer-service/runtime.ts`
- `src/server/customer-service/website/review-alert-service.ts`
- `src/server/customer-service/website/review-alert-service.test.ts`
- `src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts`
- `src/server/customer-service/website/public-updates.integration.test.ts`
- `.superpowers/sdd/2026-08-21-website-customer-assistant/task-13-fix-round-6-report.md`

## Bounded Ruling

- Resend exposes no stable team/account identifier in the current send path. Rotating an API key within the same team may conservatively terminalize an ambiguous in-flight alert even though the provider scope did not semantically change. This false-negative is fail-safe: staff still see the unresolved review, and automatic recovery cannot create a duplicate effect under a potentially different tenant.
