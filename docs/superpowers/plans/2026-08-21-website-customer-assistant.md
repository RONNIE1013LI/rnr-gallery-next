# Phase 3.7 Website Customer Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure website chat that directly displays only low-risk, policy-confirmed, validator-approved responses and durably escalates all other cases for human review.

**Architecture:** Reuse the existing channel-independent Customer Service Engine. Add an opaque website session, public session-scoped APIs, a committed website-response layer, review incidents, a deduplicated Resend outbox, manual staff website replies, and the existing PostgreSQL recovery/polling patterns.

**Tech Stack:** Next.js 16 Route Handlers, React 19, TypeScript, PostgreSQL, Drizzle, Better Auth, OpenAI Responses API, Resend, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-21-website-customer-assistant-design.md`

## Global constraints

- Start from a clean worktree containing the latest combined Production Payment Requests + Reply Assistant release.
- TDD: every task starts RED and ends GREEN before the next task.
- Additive database migration only.
- Facebook adapter, Meta callback, Messenger no-send, Policy Gate, Output Validator, approved-only Case Memory, and image-human-review behavior remain unchanged.
- Public APIs never accept a conversation/customer/database identifier.
- HIGH RISK, UNRESOLVED, and REALTIME_REQUIRED are blocked before OpenAI.
- No image AI, tools, order/payment/refund/discount actions, Website fine-tuning, or autonomous Messenger replies.
- Production remains disabled and untouched.

---

## Task 1: Channel-separated configuration

**Files:** modify `src/server/customer-service/config.ts`, `.env.example`; test `src/server/customer-service/config.test.ts`.

- [ ] Add failing tests proving Website Chat defaults off, website enablement requires session/abuse secrets but not Meta secrets, Facebook enablement still requires Meta secrets, and no secret appears in public config.
- [ ] Run `npx vitest run src/server/customer-service/config.test.ts` and confirm RED.
- [ ] Add typed website enablement, alert recipient, and website budget fields while preserving existing Facebook defaults.
- [ ] Re-run the focused test and confirm GREEN.
- [ ] Commit `feat(customer-service): separate website channel configuration`.

## Task 2: Additive website schema and migration

**Files:** modify `src/server/db/schema/customer-service.ts`; create `drizzle/0038_website_customer_assistant.sql` on the audited baseline, or the next generated number after stacking; tests `src/server/db/schema/customer-service-schema.test.ts` and repository integration test.

- [ ] Write RED schema tests for web sessions, website assistant messages, human reviews, alert outbox, and rate buckets, including unique/CAS/index/privacy constraints.
- [ ] Run schema and isolated DB migration tests and confirm RED.
- [ ] Add only new tables/indexes/constraints. Do not alter business/order/payment rows.
- [ ] Apply migration to an isolated `TEST_DATABASE_URL`; run zero-skip schema/integration tests.
- [ ] Commit `feat(customer-service): add website assistant persistence`.

## Task 3: Opaque website session ownership

**Files:** create `src/server/customer-service/website/session.ts`; tests `session.test.ts`; extend repository interface/Drizzle repository.

- [ ] Write RED tests for random token creation, HMAC-only persistence, seven-day expiry, invalid/expired fallback, no GET-created session, and two-session isolation.
- [ ] Add concurrent integration test: two first POSTs with one token create one session/conversation.
- [ ] Implement strict cookie parsing/serialization and repository CAS.
- [ ] Verify raw token and internal IDs are absent from DB DTO/log fixtures.
- [ ] Commit `feat(customer-service): add isolated website chat sessions`.

## Task 4: Website adapter and safe product context

**Files:** modify `src/server/customer-service/adapters/website.ts`; create `website/product-context.ts` and `website/model-input-sanitizer.ts`; tests for all three.

- [ ] Write RED tests for canonical website normalization and server-derived keys.
- [ ] Add RED tests proving forged role/channel/conversation/price/query data is ignored and only allowlisted product identity is accepted.
- [ ] Add RED tests proving email, phone, address, payment, order, and tracking identifiers are removed from provider input while the original customer message remains available only to authorized human review.
- [ ] Implement `WebsiteChannelPayload` normalization, registry-backed `SafeProductContext`, and fail-closed model-input minimization.
- [ ] Run adapter/product tests plus existing Facebook adapter tests.
- [ ] Commit `feat(customer-service): normalize website customer messages`.

## Task 5: Public request validation and idempotent ingest

**Files:** create `src/app/api/customer-chat/messages/{route.ts,route-handler.ts,route.test.ts}` and `website/public-api.ts`.

- [ ] Write RED tests for exact Origin, JSON type, 4 KiB body, 2,000-character message, client key format, feature-off behavior, and generic errors.
- [ ] Add duplicate POST test proving one message and one turn.
- [ ] Implement DB-first `202 accepted` flow and secure Set-Cookie for a new session.
- [ ] Verify response contains no IDs, hashes, policy details, or secrets.
- [ ] Commit `feat(customer-service): add public website message intake`.

## Task 6: Public rate limits and website cost reservations

**Files:** create `website/rate-limit.ts`; modify repository budget reservation and `usage-cost.ts`; tests/unit and DB integration.

- [ ] Write RED tests for session minute/hour/session limits, network HMAC buckets, one in-flight turn, website warning/hard stops, and global hard stop precedence.
- [ ] Add concurrency tests for two requests racing at the final allowance.
- [ ] Implement transaction/CAS counters with 24-hour bucket expiry and no raw IP.
- [ ] Prove every blocked request causes zero OpenAI calls and zero review-email storm.
- [ ] Commit `feat(customer-service): bound public chat abuse and cost`.

## Task 7: Website policy acknowledgements and review incidents

**Files:** create `website/human-review.ts`; extend repository; tests/unit and DB integration.

- [ ] Write RED cases for HIGH RISK, UNRESOLVED, REALTIME_REQUIRED, budget blocked, provider error, and validator block.
- [ ] Assert HIGH RISK/UNRESOLVED/REALTIME provider calls are zero and exact governed acknowledgement is selected.
- [ ] Implement one open review generation per conversation using transaction/CAS.
- [ ] Add tests that many messages during one open incident reuse it; resolved then reopened creates a new generation.
- [ ] Commit `feat(customer-service): persist website human review incidents`.

## Task 8: Validator-gated website publication

**Files:** create `website/publication.ts`; narrowly modify `engine.ts`, repository interfaces/Drizzle repository; tests.

- [ ] Write RED tests proving `draft_ready` alone is not public, validator PASS publishes once, validator failure exposes no model text, and Facebook remains draft-only.
- [ ] Add after/recovery/provider/human-reply race tests with unique attempt publication.
- [ ] Implement publication CAS and committed website assistant messages.
- [ ] Prove duplicate OpenAI/public responses are zero in after/recovery races.
- [ ] Commit `feat(customer-service): publish only validated website replies`.

## Task 9: Website conversation context and learning boundary

**Files:** modify context loading/repository queries and prompt builder tests; add website context tests.

- [ ] Write RED multi-turn tests with customer, committed website assistant, and human outbound chronology.
- [ ] Prove unsent AI attempts are excluded and Facebook context is unchanged.
- [ ] Prove website AI-visible messages cannot create Case Memory/Learning Candidates automatically.
- [ ] Implement channel-aware context merge and approved-only retrieval.
- [ ] Commit `feat(customer-service): add website sent context safely`.

## Task 10: Deduplicated review email outbox

**Files:** create `website/review-alert-service.ts`, `review-alert-runtime.ts`, internal route files; modify `vercel.json`; tests.

- [ ] Write RED tests for one outbox row/email per review, redacted summary, hashed expiring deep-link token, Resend idempotency key, retries, and fail-soft chat.
- [ ] Add two-worker lease/CAS race and provider-timeout tests.
- [ ] Implement best-effort after delivery plus secured one-minute Cron recovery.
- [ ] Prove email body excludes full transcript, contact/payment/address data, internal IDs, and secrets.
- [ ] Commit `feat(customer-service): alert staff to website review cases`.

## Task 11: Session-scoped incremental public updates

**Files:** create `src/app/api/customer-chat/updates/*` and `website/public-updates.ts`; tests.

- [ ] Write RED tests for session-bound signed cursor, same-timestamp ordering, duplicate polling, no session creation on GET, no-store, and two-session isolation.
- [ ] Include pending, assistant, human, review, rate, and recovery states without provider/policy internals.
- [ ] Implement indexed incremental queries only; do not load full history every poll.
- [ ] Assert polling OpenAI calls = 0.
- [ ] Commit `feat(customer-service): stream website chat updates safely`.

## Task 12: Public chat widget

**Files:** create `src/components/customer-chat/*`; modify `src/components/site-chrome.tsx` and tests.

- [ ] Write RED interaction/accessibility tests for closed default, open/close focus, Escape, Enter/Shift+Enter, retry, live updates, and preserved draft input.
- [ ] Add route-exclusion and no-overlap contract tests.
- [ ] Implement compact responsive widget with 2.5-second visible polling, focus/online catch-up, background pause, and duplicate merge.
- [ ] Validate keyboard and screen-reader labels in tests.
- [ ] Commit `feat(customer-service): add accessible website chat widget`.

## Task 13: Unified admin inbox and manual website reply

**Files:** modify Reply Assistant DTO/client/dashboard/styles; create protected website-reply route and tests.

- [ ] Write RED tests for Facebook/Website badge, website timeline, alert state, and admin/staff-only manual website reply.
- [ ] Prove anonymous 401/redirect, customer 403, forged conversation selector ignored, Facebook item cannot use website reply route.
- [ ] Implement explicit human website send that persists `human_outbound`, closes review by CAS, and creates a public update.
- [ ] Assert manual website reply causes zero OpenAI calls and zero Messenger sends.
- [ ] Commit `feat(reply-assistant): review and answer website conversations`.

## Task 14: Public security and prompt-injection regression

**Files:** create `website/security-regression.test.ts`; extend privacy/no-send/secret scans.

- [ ] Add adversarial cases for instruction override, prompt/knowledge exfiltration, encoded payloads, impersonation, URLs, tool requests, prices, guarantees, and private-case extraction.
- [ ] Add session fixation, CSRF, cookie-reset rate, expired deep link, cross-session, stale result, and alert-spam tests.
- [ ] Run focused security suite and require zero bypass/leak/action/send.
- [ ] Commit `test(customer-service): harden public website assistant boundary`.

## Task 15: Metrics, retention, and evaluation

**Files:** modify metrics/repository/UI; add retention worker and 120-case fixture/evaluator; tests.

- [ ] Write RED tests for per-channel sessions, responses, reviews, alerts, rate/budget blocks, token/cost/latency, and fixed zero business actions.
- [ ] Add retention tests for seven-day sessions, 24-hour rate buckets, 90-day unlinked chat data, and protected retained records.
- [ ] Run deterministic 120-case evaluation and unchanged Facebook/Phase 3.5/3.6 evaluations.
- [ ] Run unchanged real OpenAI evaluation and report cost delta without prompt/model changes made merely to pass.
- [ ] Commit `test(customer-service): evaluate website assistant quality and cost`.

## Task 16: Staging integration and release evidence

**Files:** minimally update `src/app/privacy/page.tsx` only after Ronnie approves wording; update Staging/rollback reports.

- [ ] Deploy Preview with Website flag enabled and Production disabled.
- [ ] Verify OpenAI data sharing is not opted in, Resend alert delivery/dedupe, auth deep link, database recovery, and public rate/cost hard stops.
- [ ] Run real-browser 390×844 and desktop checks, Payment Requests/checkout regressions, accessibility checks, console/network/privacy/secret scans.
- [ ] Record Ronnie 20-response quality review and privacy/retention sign-off; do not self-approve.
- [ ] Commit Staging evidence only after all results are actual.

## Full verification commands

```bash
npm ci
npm run knowledge:check
TEST_DATABASE_URL="$ISOLATED_TEST_DATABASE_URL" npm run test:run
npm run typecheck
npm run lint
npm run build
```

Then run the repository privacy/secret/no-send scans, unchanged conversation/learning/text evaluations, the new 120-case website evaluation, and Playwright at 390×844 plus desktop. No skipped database suite is acceptable for Staging READY.

## Task count

16 RED→GREEN tasks. Each task is independently reviewable and must be committed before the next begins.
