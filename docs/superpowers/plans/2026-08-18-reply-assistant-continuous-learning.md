# Phase 3.6 Continuous Learning from Actual Human Replies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture Meta-confirmed R&R human replies, safely associate them with the correct customer turn and AI attempts, and make only Ronnie-approved sanitized experience available as optional case memory for future human-reviewed drafts.

**Architecture:** Extend the Phase 3.5 channel-independent conversation timeline with server-classified `human_outbound` events. PostgreSQL owns dedupe, same-conversation resolution, stale-turn suppression, reply grouping, conservative matching and approved case retrieval. The policy gate runs before retrieval; approved case memory is optional prompt context beneath official knowledge and can never send, set policy, or supply realtime values.

**Tech Stack:** Next.js 16, TypeScript, Vitest, Drizzle ORM, PostgreSQL full-text search, Meta webhook Route Handler, Better Auth, OpenAI Responses provider behind the existing provider interface.

**Spec:** `docs/superpowers/specs/2026-08-18-reply-assistant-continuous-learning-design.md`

## Implementation Status — 2026-08-18

- Tasks 1-11: complete with focused RED-to-GREEN commits.
- Task 12 code verification: complete locally; 63 test files / 746 tests pass, including 71 / 71 Customer Service database integration and schema/auth tests with zero skips.
- Phase 3.5 dependency: confirmed; approved candidate `59b047d` is an ancestor of this branch.
- Migration order: `0030` -> `0031` (Phase 3.5) -> `0032` (Phase 3.6), additive only.
- External Staging validation remains pending: the unchanged real 100-case run reached the gate correctly but Preview OpenAI calls returned HTTP 401, and a real signed Test Page outbound echo is still required.
- Production, Production Meta callback, Website Chat, image AI and send capability remain unchanged.

## Global Constraints

- Base commit: `59b047dab4688cdead2ea683dd214ea7ce92ba43`.
- Phase 3.5 code and additive migration `0031` are hard prerequisites; Phase 3.6 cannot be deployed independently.
- Work only in `feat/reply-assistant-continuous-learning`; do not modify Production, Production data, Meta callback, or feature flags during implementation.
- Do not add `META_PAGE_ACCESS_TOKEN`, Messenger Send API, autonomous replies, Website Chat, image AI, order mutation, refunds, payment mutation, shipping mutation, or fine-tuning.
- HIGH RISK, `UNRESOLVED`, and `REALTIME_REQUIRED` remain blocked before case retrieval and OpenAI.
- Do not weaken the output validator, authentication, authorization, privacy controls, or no-send scans.
- Only a signed Meta echo may become `human_outbound`; AI drafts never enter sent conversation history.
- Matching is conservative. Ambiguity produces `UNMATCHED_HUMAN_REPLY`, not a guessed learning pair.
- Case memory is retrieval-eligible only after explicit admin approval and sanitation.
- Database changes are additive only; PostgreSQL remains the source of truth.
- Each task follows RED, GREEN, focused regression, then a narrow commit.

---

### Task 1: Classify and sanitize outbound Meta echoes

**Files:**
- Modify: `src/server/customer-service/types.ts`
- Modify: `src/server/customer-service/adapters/facebook.ts`
- Modify: `src/server/customer-service/adapters/facebook.test.ts`
- Create: `src/server/customer-service/conversation/human-outbound-sanitizer.ts`
- Create: `src/server/customer-service/conversation/human-outbound-sanitizer.test.ts`

**Interfaces:**
- Normalize valid signed `message.is_echo` payloads as `role: "staff"` and timeline type `human_outbound`.
- Require Page sender, customer recipient, `mid`, timestamp and non-empty supported text before acceptance.
- Sanitize text before repository persistence; retain only HMAC-hashed external keys.

- [ ] Add failing tests for valid echo direction, Page/recipient inversion, missing `mid`, missing recipient, wrong Page sender, duplicate-compatible event key, and non-message events.
- [ ] Add failing redaction tests for email, phone, bank account, full street address, order identifiers and unnecessary names.
- [ ] Run `npm test -- src/server/customer-service/adapters/facebook.test.ts src/server/customer-service/conversation/human-outbound-sanitizer.test.ts` and verify RED.
- [ ] Implement the smallest role/event classification and sanitizer contract without changing customer-message behavior.
- [ ] Re-run the focused tests and verify GREEN.
- [ ] Commit only Task 1 files.

### Task 2: Add additive continuous-learning schema

**Files:**
- Modify: `src/server/db/schema/customer-service.ts`
- Create: `drizzle/0032_reply_assistant_continuous_learning.sql`
- Modify: `drizzle/meta/_journal.json`
- Create: `drizzle/meta/0032_snapshot.json`
- Modify: `src/server/db/schema/customer-service-schema.test.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts`

**Interfaces:**
- Extend conversation events with explicit event kind and sanitized outbound metadata where an extension is required.
- Add `customer_service_human_reply_matches`, append-only match audit events, `customer_service_case_memories`, `customer_service_case_retrievals`, and `customer_service_learning_candidates`.
- Enforce unique Meta event identity, internal conversation ownership, decision state constraints, and non-retrievable default case status in PostgreSQL.

- [ ] Add failing schema and DB tests for all new tables, foreign keys, unique dedupe keys, allowed state transitions, timestamps and `reusable=false` defaults.
- [ ] Add failing tests proving no raw sender/conversation ID column and no JSONL/filesystem persistence path is introduced.
- [ ] Run schema tests and the exact repository integration suite against an isolated `TEST_DATABASE_URL`; verify RED.
- [ ] Generate/review an additive-only migration, then implement the minimal schema mappings.
- [ ] Apply migrations through `0032` to the isolated test database and run the exact tests with zero skips.
- [ ] Run `npm run db:check` and commit only Task 2 files.

### Task 3: Persist echo DB-first and suppress stale customer turns

**Files:**
- Modify: `src/server/customer-service/repositories/customer-service-repository.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts`
- Modify: `src/server/customer-service/meta/webhook-handler.ts`
- Modify: `src/server/customer-service/meta/webhook-handler.test.ts`

**Interfaces:**
- Persist a valid human outbound event in the server-resolved internal conversation before returning success.
- In the same repository transaction, suppress any still-open customer turn already answered by the human echo.
- Repository/CAS state, not worker-only logic, prevents a scheduled stale turn from becoming generation-eligible.

- [ ] Add failing DB tests for outbound persistence, duplicate echo idempotency, same-conversation ownership and echo-before-seal suppression.
- [ ] Add a concurrency test where echo persistence races with `sealDueCustomerTurn`; assert at most one terminal outcome and provider eligibility is false after the human reply wins.
- [ ] Add webhook provider-spy tests proving `outbound echo -> OpenAI calls = 0`, no deferred generation and HTTP 200.
- [ ] Run the focused repository and webhook tests; verify RED.
- [ ] Implement transactional/CAS behavior without adding a send client.
- [ ] Re-run focused tests and the existing DB-first/no-send suites; verify GREEN.
- [ ] Commit only Task 3 files.

### Task 4: Group consecutive staff messages into one human reply

**Files:**
- Create: `src/server/customer-service/conversation/human-reply-grouping.ts`
- Create: `src/server/customer-service/conversation/human-reply-grouping.test.ts`
- Modify: `src/server/customer-service/repositories/customer-service-repository.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts`
- Modify: `src/server/customer-service/config.ts`
- Modify: `src/server/customer-service/config.test.ts`

**Interfaces:**
- Group consecutive staff echoes within 90 seconds, capped at 5 messages and 2,400 sanitized characters.
- An intervening customer event, another conversation, cap overflow or expired window creates a new reply group.
- Duplicate events never extend or recreate a group.

- [ ] Add failing table tests for group boundaries, ordered content, limits and clock edges.
- [ ] Add failing DB tests for concurrent staff echoes, duplicate recovery and strict cross-conversation separation.
- [ ] Run focused tests and verify RED.
- [ ] Implement deterministic grouping and server-only bounded config.
- [ ] Re-run focused tests and verify GREEN with zero DB skips.
- [ ] Commit only Task 4 files.

### Task 5: Match human replies conservatively to customer turns and AI attempts

**Files:**
- Create: `src/server/customer-service/learning/human-reply-matcher.ts`
- Create: `src/server/customer-service/learning/human-reply-matcher.test.ts`
- Create: `src/server/customer-service/learning/edit-classifier.ts`
- Create: `src/server/customer-service/learning/edit-classifier.test.ts`
- Modify: `src/server/customer-service/repositories/customer-service-repository.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts`

**Interfaces:**
- Prefer a server-validated `reply_to.mid`; otherwise match only when exactly one eligible unanswered customer turn exists within two hours.
- Evaluate all validated AI attempts for the matched turn, not merely the newest attempt.
- Persist confidence, evidence, intent, risk, policy sources and one of `accepted_unchanged`, `edited_light`, `edited_significant`, `ai_ignored`, `independent_reply`, or `unmatched`.

- [ ] Add failing tests for exact acceptance, light/significant edits, ignored AI, no draft, delayed reply and explicit `reply_to` evidence.
- [ ] Add failing tests for two pending turns, multiple customers at the same time, topic changes and low-confidence evidence; assert `UNMATCHED_HUMAN_REPLY` where ambiguous.
- [ ] Add an append-only rematch audit test proving prior evidence is not silently overwritten.
- [ ] Run matcher, classifier and repository tests; verify RED.
- [ ] Implement deterministic matching and normalized-text similarity thresholds from the approved spec.
- [ ] Re-run focused tests and verify GREEN.
- [ ] Commit only Task 5 files.

### Task 6: Build privacy-safe Case Memory eligibility

**Files:**
- Create: `src/server/customer-service/learning/case-memory.ts`
- Create: `src/server/customer-service/learning/case-memory.test.ts`
- Create: `src/server/customer-service/learning/case-memory-sanitizer.ts`
- Create: `src/server/customer-service/learning/case-memory-sanitizer.test.ts`
- Modify: `src/server/customer-service/repositories/customer-service-repository.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts`

**Interfaces:**
- Create a non-retrievable candidate representation from a reliable human-reply match.
- Exclude HIGH RISK, realtime values, discounts, compensation, refund exceptions, damaged goods, disputes, one-off shipping, special pricing, promotions and policy overrides.
- Store normalized situation/context, sanitized final reply, product/market/deadline categories, official policy references, confidence and explicit reusable state.

- [ ] Add failing eligibility tests for every excluded category and for a normal low-risk product/process case.
- [ ] Add adversarial sanitation tests for names, emails, phone numbers, addresses, postcodes, order numbers, exact customer-specific prices and payment details.
- [ ] Add DB tests proving a created case cannot be retrieved before approval.
- [ ] Run focused tests and verify RED.
- [ ] Implement fail-closed eligibility and sanitation.
- [ ] Re-run focused privacy and DB tests; verify GREEN.
- [ ] Commit only Task 6 files.

### Task 7: Implement auditable structured case retrieval

**Files:**
- Create: `src/server/customer-service/learning/case-retrieval.ts`
- Create: `src/server/customer-service/learning/case-retrieval.test.ts`
- Modify: `src/server/customer-service/repositories/customer-service-repository.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts`

**Interfaces:**
- Use Option A: exact intent/risk/policy compatibility filters plus product/market matching and PostgreSQL full-text ranking.
- Return at most 3 approved reusable cases with score at least 70 and sanitized prompt fields only.
- Persist retrieval candidates, score components and selected/not-selected reasons without external customer IDs.

- [ ] Add failing unit tests for score components, threshold, top-3 limit, recency tie-break and no-suitable-case behavior.
- [ ] Add failing DB tests for unrelated intent, high-risk memory, current-policy conflict, old shipping price and cross-conversation private data exclusion.
- [ ] Add retrieval audit tests that can explain every selected case.
- [ ] Run focused tests and verify RED.
- [ ] Implement structured/full-text retrieval without pgvector, embeddings or external vector services.
- [ ] Re-run focused tests and verify GREEN.
- [ ] Commit only Task 7 files.

### Task 8: Integrate cases beneath Policy Gate and official knowledge

**Files:**
- Modify: `src/server/customer-service/engine.ts`
- Modify: `src/server/customer-service/engine.test.ts`
- Modify: `src/server/customer-service/prompt-builder.ts`
- Modify: `src/server/customer-service/prompt-builder.test.ts`
- Modify: `src/server/customer-service/policy-regression.test.ts`
- Modify: `src/server/customer-service/output-validator.test.ts`

**Interfaces:**
- Engine order is intent/context -> policy gate -> official knowledge -> approved golden examples -> optional approved case retrieval -> prompt -> provider -> unchanged validator.
- Blocked gates invoke case retrieval and OpenAI zero times.
- Prompt labels case memory as sanitized historical experience, forbids policy/realtime inference and preserves source precedence.

- [ ] Add failing provider/retrieval spy tests for HIGH RISK, `UNRESOLVED` and `REALTIME_REQUIRED` zero-call behavior.
- [ ] Add failing precedence tests where a case conflicts with official policy or contains a historical value; official policy wins and the value is not emitted.
- [ ] Add prompt tests for no case, one case, top 3, source labels and bounded token contribution.
- [ ] Run focused tests and verify RED.
- [ ] Implement the minimal optional retrieval step after the existing gate.
- [ ] Run engine, policy, validator, no-send and Phase 3.5 conversation regressions; verify GREEN with zero bypass.
- [ ] Commit only Task 8 files.

### Task 9: Create Learning Candidates and admin-only decisions

**Files:**
- Create: `src/server/customer-service/learning/learning-candidate.ts`
- Create: `src/server/customer-service/learning/learning-candidate.test.ts`
- Modify: `src/server/customer-service/repositories/customer-service-repository.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.ts`
- Create: `src/app/api/reply-assistant/learning-candidates/route.ts`
- Create: `src/app/api/reply-assistant/learning-candidates/route-handler.ts`
- Create: `src/app/api/reply-assistant/learning-candidates/route.test.ts`
- Create: `src/app/api/reply-assistant/learning-candidates/[candidateId]/decision/route.ts`
- Create: `src/app/api/reply-assistant/learning-candidates/[candidateId]/decision/route-handler.ts`
- Create: `src/app/api/reply-assistant/learning-candidates/[candidateId]/decision/route.test.ts`

**Interfaces:**
- Aggregate repeated edit reasons into pending candidates after a configured evidence minimum; never alter knowledge/prompt files automatically.
- `Approve`, `Edit & Approve`, and `Reject` require Better Auth plus admin `review_reply_learning`; staff may not decide.
- Approval may make a sanitized low-risk case reusable or record a separate proposal for Golden/quality/knowledge release review.

- [ ] Add failing tests for repeated edit aggregation, minimum evidence, high-risk exclusion and no automatic approval.
- [ ] Add API tests for unauthenticated 401/redirect, customer/staff 403, admin decision, invalid transition and cross-candidate isolation.
- [ ] Add tests proving browser input cannot bind an arbitrary conversation or outbound event.
- [ ] Run focused tests and verify RED.
- [ ] Implement minimal repository and route behavior using existing auth/permission patterns.
- [ ] Re-run focused tests and verify GREEN.
- [ ] Commit only Task 9 files.

### Task 10: Add a compact learning review and metrics UI

**Files:**
- Modify: `src/app/reply-assistant/page.tsx`
- Modify: `src/app/reply-assistant/reply-assistant.module.css`
- Modify: `src/app/reply-assistant/metric-cards.ts`
- Modify: `src/app/reply-assistant/metric-cards.test.ts`
- Create: `src/app/reply-assistant/learning-candidate-review.tsx`
- Create: `src/app/reply-assistant/learning-candidate-review.test.tsx`
- Modify: `src/server/customer-service/metrics.ts`
- Modify: `src/server/customer-service/metrics.test.ts`
- Modify: `src/app/api/reply-assistant/metrics/route-handler.ts`

**Interfaces:**
- Show captured human replies, matched/unmatched, acceptance/edit/ignored, reusable/excluded/retrieved cases, pending/approved/rejected candidates and common edit reasons.
- Review controls expose `Approve`, `Edit & Approve`, and `Reject` only to authorized admin users.
- Keep the page compact and usable at 390px without exposing raw external identifiers or unnecessary message content.

- [ ] Add failing metric query/format tests for every requested Phase 3.6 metric.
- [ ] Add failing UI tests for permission-aware controls, decision states, concise edit reason display and 390px-safe structure.
- [ ] Verify RED.
- [ ] Implement the smallest UI addition consistent with the existing design system.
- [ ] Run UI, metrics, auth and authorization tests; verify GREEN.
- [ ] Validate at desktop and 390px in the local/Preview environment during staging, not against Production.
- [ ] Commit only Task 10 files.

### Task 11: Build the Phase 3.6 evaluation and learning summary

**Files:**
- Create: `src/server/customer-service/fixtures/continuous-learning-evaluation-cases.jsonl`
- Create: `src/server/customer-service/continuous-learning-evaluation.test.ts`
- Create: `scripts/evaluate-customer-service-learning.ts`
- Create: `src/server/customer-service/learning/learning-summary.ts`
- Create: `src/server/customer-service/learning/learning-summary.test.ts`
- Modify: `package.json`

**Interfaces:**
- Include the 20 required scenario classes and additional adversarial cases for privacy, policy conflict, realtime leakage, races and irrelevant retrieval.
- Produce capture accuracy, matching precision, unmatched rate, retrieval precision, irrelevant injection, leakage, policy/realtime leakage, approval outcomes, edit distance, tokens, cost and latency.
- Generate a sanitized summary every 50 matched replies; only create pending candidates and never mutate Production knowledge.

- [ ] Add the unchanged expected outcomes before implementation and make the evaluator test RED on missing behavior.
- [ ] Implement deterministic fixture execution and machine-readable report output.
- [ ] Add summary tests for edit reason counts, 50-match threshold, redaction and admin approval requirement.
- [ ] Run `npm test -- src/server/customer-service/continuous-learning-evaluation.test.ts src/server/customer-service/learning/learning-summary.test.ts` and verify GREEN.
- [ ] Run the evaluation script and require leakage 0, bypass 0, violation 0, auto-send 0 and high-risk reuse 0.
- [ ] Commit only Task 11 files.

### Task 12: Complete regression, security review and staging candidate

**Files:**
- Modify only if evidence requires a narrow correction: files already listed in Tasks 1-11.
- Update: `docs/releases/2026-08-18-reply-assistant-continuous-learning-evaluation.md`
- Update: `docs/releases/2026-08-18-reply-assistant-continuous-learning-staging-validation.md`
- Update: `docs/releases/2026-08-18-reply-assistant-continuous-learning-rollback.md`

**Verification:**

- [ ] Apply migrations `0030`-`0032` to a genuinely isolated test database; pass the safety guard.
- [ ] Run all Customer Service unit and DB integration suites with zero skips.
- [ ] Run unchanged Phase 3.5 conversation evaluation and unchanged 100-case text evaluation.
- [ ] Run Phase 3.6 evaluation and record exact metrics, tokens, cost and latency.
- [ ] Run `npm run typecheck`, `npm run lint`, `npm run build`, `npm run knowledge:check`, `git diff --check`.
- [ ] Run secret/privacy scan; verify no credentials, raw Meta IDs, unnecessary customer data or JSONL Production storage.
- [ ] Run no-send scan/tests; verify no Page token, Send API client or automatic send path.
- [ ] Perform an independent code review focused on echo recursion, stale-turn race, matching precision, policy precedence, retrieval leakage and authorization.
- [ ] Create a clean candidate commit containing only Phase 3.6 implementation/docs; do not deploy Production.
- [ ] Deploy only to approved Staging/Preview after implementation review.
- [ ] Complete the real Test Page flow from the staging checklist. A real signed manual outbound echo and zero provider calls are required; synthetic fixtures alone are insufficient.
- [ ] Record every PASS/FAIL and unresolved blocker. Do not declare Staging READY unless all required checks pass.

## Implementation Completion Rule

Implementation is complete only when Tasks 1-12 are committed and reviewed, all database suites run with zero skips, all safety targets are zero, Phase 3.5 baselines do not regress, and the candidate remains human-review only. Production rollout, callback changes and feature enablement require a separate explicit approval after Staging sign-off.
