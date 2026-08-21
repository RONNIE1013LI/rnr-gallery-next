# Phase 3.7 Website Customer Assistant Staging Validation

## Evidence status

**Status: NOT RUN.** This is the Task 16 Staging evidence template. No Preview or
Production deployment, external provider check, browser check, or human sign-off is
claimed by this document.

Code-level evidence may be recorded below only after the named command has completed.
External checks must include the environment, timestamp, candidate commit, operator,
and captured evidence. An unchecked item is not a pass.

| Evidence | Result | Command or artefact |
| --- | --- | --- |
| Privacy and release-document content tests | PASS (8/8) | Local Vitest, 22 August 2026 |
| Existing security/privacy/no-send inventories | PASS (114/114) | Local Vitest, 22 August 2026 |
| TypeScript | PASS | `npm run typecheck`, 22 August 2026 |
| ESLint | PASS | Targeted ESLint, 22 August 2026 |
| Diff/scope check | PASS | `git diff --check` and protected-path inventory, 22 August 2026 |
| Preview deployment | NOT RUN | No deployment performed in this slice |
| Production changes | NONE | Task 16 code/document slice explicitly excludes Production |

## Environment boundary

- [ ] Preview deployment is built from the approved Phase 3.7 candidate stacked on the latest combined Production release.
- [ ] Production feature flag remains off/absent.
- [ ] Production domain, Meta callback, Facebook Page/App, Payment Requests, and database remain untouched.
- [ ] Isolated Preview database passes the test-database safety guard.
- [ ] All migrations are additive.

## Public session and API

- [ ] New POST sets a Secure HttpOnly SameSite cookie and stores only its HMAC.
- [ ] Seven-day expiry works; invalid/expired cookie cannot access prior data.
- [ ] GET does not create a session.
- [ ] Public APIs expose no raw/internal conversation, message, customer, sender, database, or identity key.
- [ ] Wrong Origin, non-JSON, malformed, and oversized requests fail before persistence/provider.
- [ ] Duplicate POST produces one message/turn.
- [ ] Two simultaneous sessions have zero crossover.

## Policy and provider

- [ ] DRAFT_ALLOWED response is visible only after Output Validator PASS.
- [ ] HIGH RISK provider calls = 0.
- [ ] UNRESOLVED provider calls = 0.
- [ ] REALTIME_REQUIRED provider calls = 0.
- [ ] Provider and validator failure return no rejected text and open review.
- [ ] Prompt injection and policy/knowledge exfiltration = 0.
- [ ] No current price, shipping, ETA, promotion, balance, tracking, order, refund, discount, or guarantee is guessed.
- [ ] Image-containing input remains unsupported/human review; no image fetch/provider call.

## Human review and email

- [ ] One review incident creates exactly one outbox row and one email.
- [ ] Multiple messages during one open incident create no additional email.
- [ ] Resolved then reopened incident creates one new email.
- [ ] Email contains only channel, reason, redacted 160-character summary, time, and deep link.
- [ ] Anonymous deep link redirects to login; customer is 403; admin/staff can resolve it.
- [ ] Invalid/expired token cannot select a conversation.
- [ ] Resend failure does not block chat and retries durably.
- [ ] Manual staff website reply appears in the public session and causes OpenAI = 0, Messenger send = 0.

## Recovery and concurrency

- [ ] `after()` never runs: recovery completes eligible safe turn once.
- [ ] `after()` and recovery race: one provider call/public response.
- [ ] Two recovery workers race: one lease winner.
- [ ] Human reply arrives before/during provider: stale result is not published.
- [ ] Terminal/reviewed turn is not reclaimed.
- [ ] Alert worker races: one email.
- [ ] Duplicate public responses = 0; duplicate processing = 0.

## Rate, cost, and performance

- [ ] Session and daily HMAC network limits pass at boundaries and under concurrency.
- [ ] Website and global budget hard stops block before provider.
- [ ] Raw IP persistence = 0; abuse bucket expiry <= 24 hours.
- [ ] Report requests/minute, DB query plans, average response bytes, public polling p50/p95, generation p50/p95/max, tokens, and cost.
- [ ] Polling OpenAI calls = 0.
- [ ] Average provider cost increase versus baseline is explained if above 25%.

## Admin inbox

- [ ] Facebook and Website badges are correct.
- [ ] Website customer, validated AI, and human outbound timeline order is correct.
- [ ] Learning/Case Memory excludes unreviewed Website AI output.
- [ ] Live admin polling preserves local edits.
- [ ] Facebook Copy/manual-Meta flow is unchanged.

## Browser and accessibility

- [ ] 390×844: no horizontal overflow, clipped controls, keyboard trap, or overlap with cart/checkout/navigation/cookie UI.
- [ ] Desktop: launcher/panel remain compact and do not shift layout.
- [ ] Default is closed.
- [ ] Focus enters dialog and returns to launcher; Escape closes.
- [ ] Enter and Shift+Enter behave correctly.
- [ ] Screen-reader names and polite live updates pass.
- [ ] Background tab pauses/reduces polling; focus/online catches up.
- [ ] Temporary network failure recovers without duplicate messages or lost editor text.
- [ ] Console errors = 0.

## Privacy and data governance

- [ ] OpenAI request uses `store: false`.
- [ ] OpenAI organization is not opted into API data sharing.
- [ ] `/privacy` wording is reviewed by Ronnie and accurately covers AI chat/provider/retention.
- [ ] No claim of Zero Data Retention unless separately approved and verified.
- [ ] Chat data does not enter Golden Replies, Learning Candidates, or Case Memory without human review.
- [ ] Secret, privacy, client-bundle, log, and database scans pass.

## Regression

- [ ] Full Customer Service tests pass.
- [ ] All DB suites pass with zero skips.
- [ ] Phase 3.3 text baseline does not regress.
- [ ] Phase 3.5 context evaluation passes.
- [ ] Phase 3.6 learning evaluation passes.
- [ ] Facebook incoming/echo/no-send regressions pass.
- [ ] Payment Requests, checkout, Stripe, and Afterpay critical regressions pass without real payment creation.
- [ ] TypeScript, ESLint, and build pass.
- [ ] Critical = 0; Important = 0.

## Human sign-offs

- [ ] Ronnie AI quality review: at least 20 website responses.
- [ ] Ronnie privacy and 90-day retention approval.
- [ ] Ronnie alert recipient and email wording approval.
- [ ] Ronnie rollback owner approval.

Staging is READY only when every technical item passes, all database suites have zero skips, human sign-offs are recorded, policy/cross-session leakage is zero, and Production remains unchanged. This template does not establish Staging readiness.
