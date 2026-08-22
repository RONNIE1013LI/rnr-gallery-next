# Task 13 Fix Round 1 Report

## Scope

- Branch: `feat/website-customer-assistant`
- Starting commit: `57870a29ffcca8c64abb5d8ffdbfe60cb2c0a2f7`
- Review findings closed: C1, I1, I2, M1
- Final commit: the commit containing this report; its SHA is returned in the handoff because a commit cannot contain its own SHA.

## Fixes

### C1: Website conversation serialization

- Website ingest, review open/reuse, validated publication, and manual reply now acquire the same conversation advisory lock before row locks or mutable state checks.
- Manual reply re-resolves and rechecks the open Website review after acquiring that lock.
- A committed human reply cancels stale validated publication and suppresses later-processed older inbound work, so recovery cannot revive stale AI.
- Manual resolution also terminalizes matching pending, retrying, or leased review alerts.

### I1: Opaque review selector

- Browser DTOs and reply POSTs use an authenticated HMAC selector bound to review ID, generation, and expiry.
- Raw review, conversation, and Website session IDs are not exposed by this flow.
- Tampered, expired, stale-generation, resolved, unknown, and cross-channel selectors fail closed.

### I2: Deep-link target inclusion

- Authenticated deep-link resolution loads the exact authorized queue item server-side and pins it ahead of the normal 100-item window.
- Polling preserves the selected target while it remains authorized.
- The browser cannot request an arbitrary queue item, and the deep-link token is never returned in a client DTO.

### M1: Alert settlement race

- A claimed alert receives a fresh, conversation-serialized open-review check immediately before the provider call.
- If manual resolution won, the lease is terminalized and the provider is not called.
- Sent settlement also requires the review to remain open, preventing stale workers from marking a resolved alert sent.

## RED Evidence

- Focused route/page/alert run: 9 failed, 13 passed. Failures showed the deep-link target object being discarded, opaque selectors rejected by the UUID schema, and a resolved claimed alert still reaching the provider.
- Selector unit test initially failed because the selector module did not exist.
- Database selector/alert tests failed because a raw UUID was emitted and `confirmClaimedReviewAlert` was absent.
- Three real two-connection C1 tests failed with manual reply bypassing the held conversation lock.
- UI tests showed an authorized selected item outside the newest 100 being dropped by both initial rendering and polling merge.

## GREEN Evidence

- Focused non-DB tests: 6 files, 47/47 passed.
- New repository race/isolation cases: 7/7 passed serially against the dedicated test database.
- Full Customer Service non-DB tests: 69 files, 790/790 passed.
- Full Customer Service repository integration: 1 file, 128/128 passed serially.
- Website session integration: 5/5 passed serially.
- Website public-update integration: 5/5 passed serially.
- No-send/security/manual route tests: 3 files, 21/21 passed.
- Explicit scan found no `META_PAGE_ACCESS_TOKEN`, Graph send, Messenger send, or OpenAI provider reference in the manual reply/deep-link/selector/alert path.
- `npm run typecheck`, `npm run lint`, `npm run db:check`, and `git diff --check` passed. Lint reported only three pre-existing unused-parameter warnings outside this change.

## Database And Boundaries

- No migration was added.
- Selectors expire 30 days after review opening and are invalidated by review generation changes.
- Delayed inbound suppression requires a strictly later persisted human outbound; equal timestamps retain existing causal semantics.
- Facebook behavior, Messenger delivery, AI drafting, auth permission checks, policy gates, and production/deployment remain unchanged.
