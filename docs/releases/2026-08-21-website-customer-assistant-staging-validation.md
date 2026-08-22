# Phase 3.7 Website Customer Assistant Staging Validation

## Evidence status

**Status: TECHNICAL VALIDATION COMPLETE; STAGING NOT READY.** Preview and isolated
database validation were run on 22 August 2026. Production was not changed. Final
readiness remains blocked by authenticated Preview browser validation and the four
Ronnie sign-offs listed below.

Implementation candidate: `09d68af07e1bfdd994cda9c9ab03637157b1b541`

Preview: `https://rnr-gallery-reply-preview.vercel.app`

Deployment: `dpl_HLArMg8mNZeTcwL8aP9dnob254nd`

Code-level evidence may be recorded below only after the named command has completed.
External checks must include the environment, timestamp, candidate commit, operator,
and captured evidence. An unchecked item is not a pass.

| Evidence | Result | Command or artefact |
| --- | --- | --- |
| Privacy and release-document content tests | PASS (8/8) | Local Vitest, 22 August 2026 |
| Existing security/privacy/no-send inventories | PASS (114/114) | Local Vitest, 22 August 2026 |
| Full Customer Service regression | PASS (83 files, 1,215 tests, 0 skipped) | Isolated test database, 22 August 2026 |
| Focused database regression | PASS (168/168, 0 skipped) | Isolated `rnr_phase37_test`, safety guard PASS |
| Website structured evaluation | PASS (120/120) | 60 direct, 10 no reply, 40 human review, 0 over-block |
| Phase 3.5 conversation evaluation | PASS (18/18) | 0 leakage, 0 unnecessary drafts, 0 bypass |
| Phase 3.6 learning evaluation | PASS (50/50) | 0 policy/realtime leakage, 0 high-risk reuse |
| Payment Requests critical regression | PASS (113/113) | No real payment created |
| TypeScript | PASS | `npm run typecheck`, 22 August 2026 |
| ESLint | PASS | 0 errors; existing test-only warnings recorded |
| Build | PASS | Local Next.js production build and Vercel Preview build |
| Diff/scope check | PASS | `git diff --check` and protected-path inventory, 22 August 2026 |
| Preview deployment | PASS | Ready Preview deployment above |
| Real OpenAI structured-output sample | PASS | 6/6 eligible FAQ replies rendered after remediation |
| Real human-review alerts | PROVIDER ACCEPTED | 11/11 outbox rows sent once; recipient receipt awaits Ronnie |
| Public 390x844 browser | PASS | No overflow; dialog/focus/Escape/accessibility names pass |
| Authenticated 390x844 admin browser | BLOCKED | Google OAuth `redirect_uri_mismatch` for Preview callback |
| Production changes | NONE | No Production deploy, callback, database or feature flag change |

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

Staging is READY only when every technical item passes, all database suites have zero skips, human sign-offs are recorded, policy/cross-session leakage is zero, and Production remains unchanged. This document currently records **Staging NOT READY**.

## Structured-output quality evidence

- Deterministic set: 120/120 gate and outcome matches; direct reply 50%, no reply
  8.33%, human review 33.33%, over-block 0%, required-information coverage and
  template naturalness 100%.
- Initial real-provider sampling exposed four safe-but-incompatible decisions. The
  prompt did not expose the renderer's intent-specific allowlist. The validator
  correctly failed closed and was not changed.
- After adding the renderer-derived prompt contract, six eligible design/photo FAQ
  messages on the final Preview candidate produced six `draft_ready`
  server-rendered replies, with zero schema incompatibility, unsupported claim,
  policy bypass, cross-session leakage, or automatic send.
- Final single-call evidence: 711 input tokens, 63 output tokens, 218 micro-USD,
  1,585 ms. Five-call remediation sample range: 1,854-3,200 ms and 210-224
  micro-USD per call.
- HIGH RISK, UNRESOLVED and REALTIME_REQUIRED remained blocked before provider.
  Duplicate incident delivery created one persisted review and one alert.
- Private/current draft requests are now blocked as REALTIME_REQUIRED before the
  provider. Real Preview evidence: `Can I see my design draft?` produced a
  `gate_blocked` attempt with `provider_called=false`; a general design-process
  question in the same deployment remained `draft_ready`.
- Final real Preview mutation evidence on deployment
  `dpl_HLArMg8mNZeTcwL8aP9dnob254nd`: a mixed-script current-proof request was
  `realtime_required`, `gate_blocked`, and `provider_called=false`. A generic
  draft-process question remained `allowed` and `draft_ready`, with 721 input
  tokens, 68 output tokens, 226 micro-USD, and 2,484 ms latency.
- Final independent review at implementation candidate `09d68af`: Critical 0,
  Important 0. The bounded mutation matrix verified private-record blocking,
  generic-process eligibility, Website evaluator channel parity, Facebook
  isolation, structured rendering, and no-send.
- Website recovery claims now carry a database-enforced channel allowlist. The
  isolated PostgreSQL regression proves that a Facebook-only recovery worker leaves
  an earlier due Website turn open and claims only the Facebook turn.

## Browser evidence

- Public Website chat at 390x844: document client/scroll width 375/375; dialog width
  351 px inside the viewport; no clipped control or console error observed.
- Dialog has the accessible name `Chat with R&R Gallery`; focus enters the message
  textarea, Escape closes it, and focus returns to the launcher.
- Authenticated `/reply-assistant` mobile validation remains blocked because the
  Google OAuth client rejects the Preview callback with `redirect_uri_mismatch`.

## Remaining blockers

1. Add the Preview Google OAuth callback URL to the approved Google client, then
   complete authenticated admin/staff/customer authorization and 390x844 admin UI
   validation.
2. Ronnie must review at least 20 representative Website replies.
3. Ronnie must approve the final Privacy wording and 90-day retention disclosure.
4. Ronnie must confirm receipt of a Staging alert and approve the alert recipient,
   email wording and rollback ownership.
5. Confirm in the OpenAI organization UI that API data sharing is disabled; this
   document does not infer that setting from `store: false`.

## External alert evidence

- Environment: Vercel Preview with isolated Staging PostgreSQL.
- Operator: Codex. Evidence captured 22 August 2026 after deployment
  `dpl_G9beEGmKmBkBKxHRbx1Aj9mYGJZf`.
- `REPLY_ASSISTANT_ALERT_TO` is an encrypted, branch-scoped Preview variable;
  `RESEND_API_KEY` and `EMAIL_FROM` are configured server-side. No value was read or
  recorded in this document.
- Database outbox evidence: 11 rows, 11 `sent`, 0 non-sent, one attempt each,
  provider-start marker and payload digest present for every row. Accepted send
  timestamps span `2026-08-21T22:59:25.653Z` to `2026-08-22T00:09:47.557Z`.
- This proves provider acceptance and durable single-attempt settlement, not inbox
  delivery. Ronnie receipt confirmation remains a human sign-off blocker.
