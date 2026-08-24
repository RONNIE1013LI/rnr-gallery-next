# Task 13 Fix Round 2 Report

## Scope

- Branch: `feat/website-customer-assistant`
- Starting commit: `0780028a8b53b145057f7539ff80c7449c3f464f`
- Findings closed: I1 canonical selector, I2 renewable bounded selector, M1 alert send linearization
- Final commit SHA is returned in the handoff because a commit cannot contain its own SHA.

## Fixes

### I1: Canonical selector encoding

- Verification reconstructs the complete canonical selector and timing-safe compares its exact bytes.
- Leading-zero base36 expiry aliases and all three non-significant base64url pad-bit aliases fail closed.
- Modified selectors continue through the generic `unavailable` response; no review, conversation, session, PSID, or deep-link identifier is exposed.

### I2: Renewable bounded selectors

- Selector issuance now uses an injected clock and a stable UTC-day window.
- Each selector expires 30 days after its issuance window starts and remains bound to review ID, generation, and expiry.
- A still-open review receives a fresh selector from queue, live polling, or authorized deep-link resolution after the window changes.
- Captured prior selectors expire, while a freshly listed day-31 selector can answer the same still-open review.
- Deep-link token hashing, seven-day deep-link expiry, server-side target loading, and pinning are unchanged.

### M1: Persisted send linearization

- Migration `0050_sticky_mysterio.sql` adds the constrained `sending` outbox status.
- After the existing fresh confirmation, the worker acquires the shared conversation lock and CASes `leased` to `sending` before invoking the provider.
- Manual resolution that wins before this CAS terminalizes the lease and produces zero provider calls.
- If `sending` wins first, manual resolution proceeds without overwriting the delivery state; provider success settles `sending` to `sent` even after review resolution.
- A known provider failure after resolution settles terminally as resolved instead of creating a dead retry.
- Provider-success settlement errors propagate without scheduling a duplicate provider retry.
- `sending` is not claimable by another worker; the existing one-alert and idempotency-key uniqueness constraints remain unchanged.

## RED Evidence

- Selector unit run: 2 failed, 2 passed. Non-canonical aliases verified as true and day-31 issuance reproduced the original selector.
- Typecheck failed at repository callers still passing `openedAt` without issuance time.
- Renewable-selector DB run: 1 failed, 128 skipped; queue issuance had no injected current time.
- Alert service run: 3 failed, 6 passed; no linearization call occurred, post-confirmation resolution still sent, and worker-first ordering was not represented.
- Alert DB race run: 2 failed, 129 skipped; manual-after-confirmation still returned `sent`, and worker-first did not persist the concurrent resolution.
- Settlement self-review test: 1 failed, 10 skipped; provider success plus DB settlement failure incorrectly returned `retry_wait`.

## GREEN Evidence

- Focused selector/alert/schema unit tests: 20/20 passed; final alert service run: 11/11 passed.
- Focused selector and alert DB cases: 4/4 passed; expanded alias DB case: 1/1 passed.
- Full repository integration, serial: 131/131 passed in 320.03 seconds, zero skipped.
- Website session integration, serial: 5/5 passed, zero skipped.
- Website public-update integration, serial: 5/5 passed, zero skipped.
- Website schema integration, serial: 4/4 passed, zero skipped.
- Full Customer Service and Reply Assistant non-DB suite: 69 files, 796/796 passed.
- `npm run typecheck`, `npm run lint -- --quiet`, `npm run db:check`, and `git diff --check` passed.
- Explicit no-send scan found no Meta token, Graph send, Messenger send, or OpenAI provider reference in the manual Website reply/review path.

## Migration And Boundaries

- Added `drizzle/0050_sticky_mysterio.sql` plus generated snapshot/journal metadata.
- The verified dedicated test database had a pre-existing migration-ledger divergence for later Website migrations, so the safety-checked migration runner did not advance it. Only migration 0050 was then applied transactionally to that confirmed test database for DB verification. No production database was touched.
- The public-update plan test passed 5/5 on rerun, so its query and indexes were not changed.
- Facebook behavior, manual no-send behavior, auth/policy gates, deep-link authorization, and production/deployment remain unchanged.
