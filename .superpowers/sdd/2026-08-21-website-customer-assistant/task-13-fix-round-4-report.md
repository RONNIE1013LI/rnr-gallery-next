# Task 13 Fix Round 4 Report

## Scope

- Branch: `feat/website-customer-assistant`
- Starting commit: `b09cd017e75266000d445e7853ec7cc1d3560989`
- Findings closed: I1 provider idempotency horizon and M1 selector-secret rotation.
- No Task 14, Facebook behavior, production configuration, deployment, schema, or migration changes were added.

## Fixes

- Added one documented 23-hour automatic recovery cutoff, strictly below Resend's 24-hour idempotency retention.
- Expired linearized leases before the cutoff retain the same provider idempotency key and may recover. At or after the cutoff, claim atomically terminalizes the outbox as `failed` with `provider_idempotency_window_expired_unknown_result`, clears lease metadata, and makes no provider call.
- The human review remains open and visible with failed alert status after fail-safe terminalization. Terminal rows are not reclaimed, and competing workers remain serialized by the existing conversation lock and row CAS.
- Same-window selector issuance now atomically upserts the current selector digest and returns a selector only when the returned persisted digest matches the current process. The old-secret selector fails closed and the current-secret selector remains usable.
- Secret rotation is explicitly bounded to a coordinated deployment. Mixed-secret processes are unsupported because the same secret also signs active customer sessions; a single current deployment cannot emit an unpersisted selector.

## RED Evidence

- Idempotency-horizon database regressions: 2 failed, 1 passed, 135 skipped. At the 23-hour boundary and after 25 hours, a recovery worker still called the provider.
- Selector-rotation database regression: 1 failed, 138 skipped. The queue emitted a current-secret selector while the indexed row retained the old-secret digest.
- Recovery-policy unit test initially failed to resolve the missing policy module.

## GREEN Evidence

- Focused policy unit test: 1/1 passed.
- Focused cutoff, provider-expiry, and within-window recovery database cases: 3/3 passed.
- Focused selector-rotation database case: 1/1 passed.
- Combined focused unit surface: 3 files, 16/16 passed.
- Combined focused database surface: 8/8 passed.
- Full repository integration, serial: 139/139 passed, zero skipped.
- Session, public-update, Website schema, and Customer Service schema database suites, serial: 4 files, 40/40 passed, zero skipped.
- Full Customer Service and Reply Assistant non-integration surface: 74 files, 837 passed, 3 database-gated cases skipped; those cases passed in the zero-skip database run above.
- `npm run typecheck`, `npm run lint -- --quiet`, `npm run db:check`, and `git diff --check` passed.
- Migration guard passed while inspecting Task 10-13 migrations including additive 0050. The Round 4 diff contains no migration changes.
- Privacy/no-send scan found no Meta page token, Graph/Messenger send, or OpenAI send addition.

## Files

- `.env.example`
- `src/server/customer-service/website/review-alert-policy.ts`
- `src/server/customer-service/website/review-alert-policy.test.ts`
- `src/server/customer-service/repositories/drizzle-customer-service-repository.ts`
- `src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts`
- `.superpowers/sdd/2026-08-21-website-customer-assistant/task-13-fix-round-4-report.md`

## Migration And Ruling

- No migration was added or changed. Existing additive `0050_furry_human_torch.sql`, its snapshot, journal entry, and constraints remain unchanged.
- Provider outcomes older than the automatic recovery horizon are deliberately reported as unknown and terminalized rather than risking a duplicate effect after provider idempotency retention lapses. Staff can still act on the unresolved review through the Reply Assistant.
