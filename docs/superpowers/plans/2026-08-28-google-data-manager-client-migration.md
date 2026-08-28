# Google Data Manager Client Migration — Phase 0C

## Goal

Replace the legacy Google Ads `UploadClickConversions` client with a code-only,
mock-tested Google Data Manager API implementation. Keep all Production delivery
disabled until a durable delivery outbox exists and the separate platform/OAuth
phase is explicitly approved.

## Global constraints

- This phase changes code, tests, examples, and documentation only.
- Do not call Google, configure OAuth, edit Vercel, enable feature flags, deploy,
  or touch Production data.
- Do not generate, edit, or execute database migrations. The migration freeze is
  active.
- Do not create a Google Ads conversion action or change ads, budgets, GA4,
  Merchant Center, Meta, payment logic, or order logic.
- Do not place real PII, click identifiers, credentials, or hashes in fixtures,
  logs, commits, or reports.
- Google execution must fail closed without a durable delivery repository.
- The existing Meta conversion path must keep its current behavior.
- All implementation follows red-green-refactor TDD.

## Task 1 — Pure Data Manager event and eligibility domain

**Files**

- Create `src/domain/analytics/google-data-manager.ts`
- Create `src/domain/analytics/google-data-manager.test.ts`

**Implementation**

1. Define explicit immutable Data Manager event, consent, destination-safe input,
   delivery result, and skipped-reason types.
2. Implement Google-compatible local normalization and SHA-256 hexadecimal
   hashing for email and E.164 phone values. Gmail/Googlemail removes dots and
   the plus suffix; other domains do not.
3. Map manual order source to `WEB`, `MESSAGE`, `PHONE`, or `OTHER`.
4. Map one valid `gclid`, `gbraid`, or `wbraid` to `adIdentifiers` without
   accepting multiple competing identifiers.
5. Convert integer minor units to decimal conversion value without floating
   point drift and allow only `NZD` or `AUD`.
6. Build the pure event with stable transaction ID, confirmed-payment timestamp,
   currency, value, event source, identifiers/user data, and consent:
   `adUserData=CONSENT_GRANTED`, `adPersonalization=CONSENT_DENIED`.
7. Implement strict future-only eligibility. Require both feature flags, a valid
   RFC3339 UTC activation time, order creation and payment confirmation at or
   after activation, an actual non-paid to paid transition, granted consent,
   useful matching evidence, a non-successful prior state, and durable delivery.
8. Return explicit disabled/skipped/blocked outcomes. Missing or denied consent,
   historical orders, paid-to-paid saves, missing timestamps, invalid activation,
   and missing durable storage must never proceed.

**Tests**

- Exact endpoint-independent event shape and immutable stable transaction ID.
- NZD/AUD money conversion and invalid currency/value rejection.
- WEB/MESSAGE/PHONE/OTHER mapping.
- gclid/gbraid/wbraid mapping and invalid/multiple identifier rejection.
- Gmail/Googlemail dot and plus normalization, non-Gmail preservation, whitespace
  handling, E.164 phone normalization, SHA-256 lowercase hex output.
- Consent granted/denied/missing behavior.
- Both flags, valid/invalid/missing activation, creation/confirmation boundaries,
  historical exclusion, missing confirmed time, paid transition, paid-to-paid,
  already delivered, and no durable store.
- Use synthetic `example.com` identities and fake identifiers only.

## Task 2 — Data Manager HTTP client, diagnostic validation, and status parsing

**Files**

- Create `src/server/analytics/google-data-manager-client.ts`
- Create `src/server/analytics/google-data-manager-client.test.ts`
- Delete `src/server/analytics/google-ads-offline-client.ts`
- Delete `src/server/analytics/google-ads-offline-client.test.ts`

**Implementation**

1. Use `POST https://datamanager.googleapis.com/v1/events:ingest` and OAuth scope
   `https://www.googleapis.com/auth/datamanager`. Never send a developer token.
2. Parse destination config into a `GOOGLE_ADS` operating account with digits-only
   ID and configured `productDestinationId`. Include a login account only when
   both its supported type and digits-only ID are complete. Do not support a
   linked account.
3. Inject token provider, fetch transport, time, and safe logger so all tests are
   hermetic and no real Google request is possible.
4. Expose a synthetic-only diagnostic method that always sends
   `validateOnly: true`. It must not be a public route or order-save hook.
5. Expose a future execution method using `validateOnly: false`, but require an
   actual durable delivery repository capability. With no repository, return
   `blocked_no_durable_store` before token acquisition or HTTP.
6. Parse accepted `requestId`, then retrieve
   `GET /v1/requestStatus:retrieve?requestId=...`. Only destination `SUCCESS`
   returns succeeded. Preserve `PROCESSING`, `PARTIAL_SUCCESS`, and `FAILED` as
   non-success outcomes.
7. Classify 408/429/5xx as retryable and 400/403 as permanent. Do not add a retry
   worker in this phase.
8. Logs may contain only safe operational metadata: status class, request ID,
   destination account suffix where necessary, and transaction ID. Never log
   event payloads, PII, hashes, click IDs, access tokens, or response bodies.

**Tests**

- Config complete/incomplete/invalid, digit normalization, optional login account,
  no linked account, and no developer-token header.
- Exact OAuth scope and exact ingest/status URLs.
- Diagnostic is forced validate-only, synthetic-only, and uses mocks.
- Execute without repository acquires no token and performs no HTTP request.
- Execute request uses `validateOnly: false` only after repository capability.
- Request ID acceptance/missing ID; SUCCESS, PROCESSING, PARTIAL_SUCCESS, FAILED.
- 408, 429, 5xx retryable; 400 and 403 permanent; sanitized logging.
- Duplicate successful transaction is stopped by the mocked durable repository.

## Task 3 — Runtime disconnection, static cleanup, and durable outbox design

**Files**

- Modify `src/server/analytics/manual-conversion-dispatcher.ts`
- Modify `src/server/analytics/manual-conversion-dispatcher.test.ts`
- Modify `src/server/admin/admin-production-runtime.ts`
- Modify relevant runtime tests only where required
- Modify `.env.example`
- Create `docs/superpowers/specs/google-data-manager-delivery-outbox-design.md`
- Add a focused static regression test in the existing analytics test convention

**Implementation**

1. Remove the old Google Ads client, types, endpoint, developer-token header,
   Adwords scope, hardcoded granted consent, and the old live
   `validateOnly: false` runtime connection.
2. Keep the Meta dispatcher unchanged. Make the Google runtime sender explicitly
   disabled in Phase 0C; do not instantiate or connect the new client from order
   persistence.
3. Update `.env.example` with only non-secret, disabled Data Manager configuration
   names and the future activation timestamp. Do not add OAuth credentials.
4. Document the required durable outbox: immutable event identity, pending and
   accepted states, request ID, attempt metadata, safe errors, retry scheduling,
   terminal status, uniqueness, crash recovery, and dead-letter operations.
   State clearly that it requires a future migration after the freeze and that
   Production execution remains blocked.
5. Document the existing transition-observer limitation: current manual job save
   cannot reliably prove persisted non-paid to paid. Future wiring must use an
   authoritative committed transition plus durable outbox transaction.
6. Add static assertions that runtime source contains no legacy endpoint,
   developer-token header, Adwords scope, hardcoded consent grant, or old client
   import, and that no new public diagnostic route exists.

**Tests**

- Existing Meta manual conversion dispatch remains green.
- Google dispatch is disabled and cannot call Data Manager.
- Runtime construction requires no Google OAuth/config and makes no Google call.
- Static cleanup assertions pass.

## Final verification

1. Focused domain, client, dispatcher, candidate, and runtime tests.
2. Full `npm run test:run`.
3. `npm run typecheck`.
4. `npm run lint`.
5. `npm run db:check` (read-only schema consistency only).
6. `npm run build` with safe non-Production build configuration.
7. `git diff --check`.
8. Static scan for secrets, real identifiers/PII, the legacy endpoint/header/scope,
   hardcoded granted consent, and unintended `validateOnly: false` runtime wiring.
9. Independent final code review focused on privacy, consent, future-only gates,
   idempotency boundaries, logging, and accidental Production activation.

## Expected end state

- Google Data Manager client: code-migrated and mock-tested.
- Validate-only: mock-tested only.
- Production OAuth: not configured.
- Production execution: disabled.
- Historical backfill: disabled.
- Durable delivery: `BLOCKED_PENDING_DURABLE_OUTBOX_MIGRATION`.
- Ads remain paused and cost remains NZ$0.
