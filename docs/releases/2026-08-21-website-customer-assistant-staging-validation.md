# Phase 3.7 Website Customer Assistant Staging Validation

## Evidence status

**Status: STAGING READY.** Preview and isolated database validation were run on
22 August 2026. Production was not changed. Preview OAuth, authenticated mobile
validation, Website response quality, Privacy wording, email delivery, exactly-once
alerting, secure deep-link access and rollback ownership are approved. The final
focused recheck found no remaining Critical or Important issue.

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
| Website structured evaluation after quality remediation | PASS (120/120) | 60 direct, 10 no reply, 40 human review, 0 over-block |
| Ronnie wording remediation | PASS | 14/14 reviewed response cases represented by fixed server-side templates/fragments and approved by Ronnie after final spot review |
| Phase 3.5 conversation evaluation | PASS (18/18) | 0 leakage, 0 unnecessary drafts, 0 bypass |
| Phase 3.6 learning evaluation | PASS (50/50) | 0 policy/realtime leakage, 0 high-risk reuse |
| Payment Requests critical regression | PASS (113/113) | No real payment created |
| TypeScript | PASS | `npm run typecheck`, 22 August 2026 |
| ESLint | PASS | 0 errors; existing test-only warnings recorded |
| Build | PASS | Local Next.js production build and Vercel Preview build |
| Diff/scope check | PASS | `git diff --check` and protected-path inventory, 22 August 2026 |
| Preview deployment | PASS | Ready Preview deployment above |
| Real OpenAI structured-output sample | PASS | 6/6 eligible FAQ replies rendered after remediation |
| Final focused Website regression | PASS (29 files, 465/465, 0 skipped) | Isolated PostgreSQL, 22 August 2026 |
| Final security/privacy/no-send regression | PASS (118/118) | Local Vitest, 22 August 2026 |
| Final email dedupe/deep-link regression | PASS (181/181) | Local Vitest, 22 August 2026 |
| Final privacy database audit | PASS | 11 tables/11 rows; 0 forbidden rows, columns, scope violations or rollback residue |
| Real human-review alerts | PASS | Provider accepted; Ronnie confirmed exactly one inbox delivery and correct authenticated deep link |
| Public 390x844 browser | PASS | No overflow; dialog/focus/Escape/accessibility names pass |
| Authenticated 390x844 admin browser | PASS | Preview OAuth callback added without changing localhost/Production; Admin login and protected page verified, no overflow or console errors |
| OpenAI API input/output sharing | PASS | Organization Data controls showed `Share inputs and outputs with OpenAI` = Disabled, 22 August 2026 at 13:16 NZST |
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
- [x] OpenAI organization is not opted into API data sharing.
- [x] `/privacy` wording is reviewed by Ronnie and accurately covers AI chat/provider/retention.
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

- [x] Ronnie Website response quality sign-off: `PASS` for the current structured Website Assistant customer-facing responses. This does not permit weakening Policy Gate, REALTIME_REQUIRED, HIGH RISK, structured output or server-side template rendering.
- [x] Ronnie privacy and 90-day retention approval (`APPROVED`, with OpenAI described as a technical service provider).
- [x] Ronnie alert recipient, exactly-once inbox delivery and secure deep-link approval.
- [x] Ronnie rollback owner approval (`Ronnie Li`, approved 22 August 2026).

Staging is READY only when every technical item passes, all database suites have zero skips, human sign-offs are recorded, policy/cross-session leakage is zero, and Production remains unchanged. The accepted full checklist plus the final focused recheck now record **Staging READY**.

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
- Authenticated `/reply-assistant` at 390x844: Admin OAuth login PASS; protected page
  rendered Website/Facebook channel state, timelines, review state, learning/case data,
  metrics and knowledge provenance with document scroll width 375 inside a 390 px
  viewport and zero console errors.

## Remaining blockers

None for Staging. Production deployment and public Website Chat enablement remain a
separate rollout decision.

## Website response quality remediation

- Initial Ronnie review: 6 approved, 14 needs edit, 0 rejected; direct approval 30%,
  assisted acceptance 100%. This result is not recorded as a Production quality PASS.
- Final remediation spot review: 13 approved, 1 needs edit, 0 rejected. The remaining
  A3-price reply was corrected to avoid implying that one answer necessarily completes
  quote collection, after which Ronnie approved all 14 remediated responses and recorded
  Website response quality as `PASS`.
- The 14 edited answers are implemented only as version-controlled, allowlisted
  `website-response-v1` fragments or intent-specific human-review templates. Website
  model prose remains structurally unable to reach a customer.
- Vague openings now clarify rather than escalate. Product recommendations answer
  directly and include a reason. Quote continuation confirms the supplied detail before
  asking only the next relevant fields, with delivery location conditional on delivery.
- Current price and shipping questions remain blocked before the provider, then receive
  a narrowly targeted information request. Damage, cancellation/refund, duplicate-charge
  and private issues remain human-review cases with safe intent-specific next steps.
- Provider/output/system failure uses the approved system-failure wording and tells the
  customer not to submit the message again.
- Duplicate-charge wording is now explicitly HIGH RISK before provider invocation.
- Deterministic 120-case evaluation remained unchanged: policy bypass 0, unsupported
  realtime claims 0, direct unsafe free text 0, cross-session leakage 0, automatic
  business actions 0 and automatic sends 0.
- Email provider acceptance, actual inbox delivery, exactly-once receipt and the
  authenticated deep-link destination are `PASS`, confirmed by Ronnie.

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
- Ronnie subsequently confirmed one actual inbox delivery, no duplicate alert, and that
  `Open Reply Assistant` authenticated successfully into the correct Website conversation.

## Final focused recheck

- Website focused regression: 29 files, 465/465 PASS, 0 skipped, using an isolated
  PostgreSQL test database whose safety guard and additive migrations passed.
- Unchanged Website evaluation: 120/120 gate and outcome matches; 60 direct replies,
  10 no-reply outcomes, 40 human-review outcomes, 0 over-block, 100% required-information
  coverage and naturalness.
- Safety: policy bypass/violation 0/0, cross-session leakage 0, unsupported realtime
  claims 0, unsafe model prose 0, automatic business actions 0 and automatic sends 0.
- Email and deep link: focused regression 181/181 PASS; exactly-once delivery and correct
  authenticated conversation access confirmed by Ronnie.
- Static verification: TypeScript PASS; ESLint 0 errors (10 existing test-only warnings);
  production build PASS; diff, privacy, secret and no-send scans PASS.
- Browser: public Website Chat and authenticated `/reply-assistant` both passed at
  390x844 with document width 375/375, no clipped controls, no horizontal overflow and
  no console errors.
- Final findings: Critical 0; Important 0.
