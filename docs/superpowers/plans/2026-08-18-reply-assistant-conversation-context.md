# Phase 3.5 Conversation-Aware Messenger Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert raw Facebook message events into isolated, context-aware meaningful customer turns while preserving the existing human-review-only, policy-gated drafting flow.

**Architecture:** Add additive conversation-event and customer-turn persistence beside the existing message/attempt tables. The repository owns dedupe, debounce, turn sealing, acknowledgement suppression, pilot allocation and same-conversation history; the channel-independent engine consumes role-labelled context and resolves short follow-ups before the unchanged policy gate/provider/validator path.

**Tech Stack:** Next.js 16, TypeScript, Vitest, Drizzle ORM, PostgreSQL, Meta webhook Route Handler, OpenAI Responses provider behind the existing interface.

## Global Constraints

- Base commit: `12d3f581945badaaf06f2d1fd9a047069bcbfbd6`.
- Do not deploy, alter Production, switch Meta callback, or change Production feature flags.
- Do not implement Website Chat, image AI, Send API, or auto-send.
- HIGH RISK, `UNRESOLVED`, and `REALTIME_REQUIRED` remain blocked before OpenAI.
- Keep the existing output validator and no-send safeguards.
- Store only HMAC-hashed external identifiers and retrieve history server-side by current internal conversation.
- Database migration is additive only.
- Every behavior follows RED, GREEN, regression verification.

---

### Task 1: Normalize customer and staff conversation events

**Files:**
- Modify: `src/server/customer-service/types.ts`
- Modify: `src/server/customer-service/adapters/facebook.ts`
- Modify: `src/server/customer-service/adapters/facebook.test.ts`
- Modify: `src/server/customer-service/adapters/website.test.ts`

**Interfaces:**
- Produce `NormalizedConversationEvent` with `role: "customer" | "staff"`.
- Facebook echoes use recipient PSID as the conversation key and never expose it outside the webhook hashing boundary.

- [ ] Add failing tests for customer role, staff echo role/recipient mapping, missing recipient fail-closed, and ignored delivery/read events.
- [ ] Run adapter tests and verify RED because echoes are currently discarded.
- [ ] Implement the minimal role-aware normalization.
- [ ] Run adapter and Website interface tests; verify GREEN.
- [ ] Commit Task 1 files.

### Task 2: Add conversation event and meaningful turn persistence

**Files:**
- Modify: `src/server/db/schema/customer-service.ts`
- Create: `drizzle/0031_reply_assistant_conversation_context.sql`
- Modify: `drizzle/meta/_journal.json`
- Create: `drizzle/meta/0031_snapshot.json`
- Modify: `src/server/customer-service/repositories/customer-service-repository.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts`

**Interfaces:**
- Ingest accepts a hashed `role` and returns `context_only`, `turn_pending`, `duplicate`, or `pilot_complete`.
- New tables retain internal conversation IDs, hashed event keys, role-labelled text, debounce timestamps, turn status and representative message IDs.

- [ ] Add failing DB tests for same-sender conversation reuse, staff context-only persistence, customer-event dedupe, and cross-customer isolation.
- [ ] Run exact DB tests and verify RED because event/turn tables do not exist.
- [ ] Add schema, migration and minimal transactional repository behavior.
- [ ] Apply migration to an isolated test database and run exact tests with zero skips.
- [ ] Commit Task 2 files.

### Task 3: Aggregate rapid customer fragments with repository CAS

**Files:**
- Modify: `src/server/customer-service/repositories/customer-service-repository.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts`
- Modify: `src/server/customer-service/config.ts`
- Modify: `src/server/customer-service/config.test.ts`

**Interfaces:**
- Add `sealDueCustomerTurn({ turnId, now })` returning one of `not_due`, `sealed`, `suppressed`, `duplicate`, or `pilot_complete`.
- Debounce defaults to a bounded server-only value and is configurable without exposing secrets.

- [ ] Add failing tests for two rapid fragments becoming one ordered body, a later fragment becoming a new turn, concurrent seal idempotency, and pilot allocation once per sealed turn.
- [ ] Run exact tests and verify RED.
- [ ] Implement open-turn extension and transactional/CAS sealing.
- [ ] Run concurrency, pilot and config tests; verify GREEN with zero DB skips.
- [ ] Commit Task 3 files.

### Task 4: Suppress completed acknowledgements before pilot/provider work

**Files:**
- Create: `src/server/customer-service/conversation/acknowledgement.ts`
- Create: `src/server/customer-service/conversation/acknowledgement.test.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts`

**Interfaces:**
- Produce `classifyAcknowledgement(currentText, recentHistory)` with `suppress` and a stable reason code.
- A recent staff question prevents suppression of a meaningful `yes`.

- [ ] Add failing table-driven tests for thanks/okay/got-it suppression, context-required yes, and non-acknowledgement short answers.
- [ ] Verify RED because the classifier is absent.
- [ ] Implement conservative deterministic classification and integrate it before pilot allocation.
- [ ] Run unit and DB tests; assert suppressed turns consume zero pilot slots and provider calls.
- [ ] Commit Task 4 files.

### Task 5: Retrieve role-labelled same-conversation history

**Files:**
- Modify: `src/server/customer-service/repositories/customer-service-repository.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts`
- Modify: `src/server/customer-service/prompt-builder.ts`
- Modify: `src/server/customer-service/prompt-builder.test.ts`

**Interfaces:**
- `DraftInput.context` becomes bounded `ConversationContextItem[]` with role, text and timestamp.
- `loadDraftInput` derives conversation scope only from the current internal message/turn; it accepts no caller-supplied conversation ID.

- [ ] Add failing tests for ordered customer/staff history, bounds, current-turn aggregation, same-timestamp ordering and cross-conversation exclusion.
- [ ] Verify RED because only customer strings are currently loaded.
- [ ] Implement scoped retrieval and role-labelled prompt formatting.
- [ ] Run repository, prompt privacy and cross-customer tests; verify GREEN.
- [ ] Commit Task 5 files.

### Task 6: Resolve contextual short replies before the unchanged policy gate

**Files:**
- Create: `src/server/customer-service/conversation/contextual-intent.ts`
- Create: `src/server/customer-service/conversation/contextual-intent.test.ts`
- Modify: `src/server/customer-service/engine.ts`
- Modify: `src/server/customer-service/engine.test.ts`
- Modify: `src/server/customer-service/policy-regression.test.ts`

**Interfaces:**
- Produce `resolveContextualIntent({ currentText, history, baseIntent })` returning an effective intent and safe context summary.
- Current-message HIGH RISK/realtime classification is evaluated before any inherited low-risk intent can be used.

- [ ] Add failing tests for location, size, date, photo-count, product/pronoun follow-ups and unrelated new questions.
- [ ] Add provider-spy tests proving HIGH RISK, realtime and unresolved follow-ups still invoke OpenAI zero times.
- [ ] Verify RED because short replies currently resolve to unknown/tone.
- [ ] Implement minimal resolver and engine ordering without changing policy rules or validator.
- [ ] Run engine and policy regressions; verify GREEN and zero bypass.
- [ ] Commit Task 6 files.

### Task 7: Wire debounce and staff context through Meta webhook

**Files:**
- Modify: `src/server/customer-service/meta/webhook-handler.ts`
- Modify: `src/server/customer-service/meta/webhook-handler.test.ts`
- Modify: `src/app/api/meta/webhook/route-handler.ts`
- Modify: `src/app/api/meta/webhook/route.test.ts`
- Modify: `src/server/customer-service/runtime.ts`

**Interfaces:**
- Webhook persists both roles DB-first.
- Staff/context-only events schedule nothing; customer turns schedule `sealDueCustomerTurn` through `after()` and generate only when sealing returns an eligible representative message.

- [ ] Add failing tests for staff echo persistence/no generation, rapid fragment coalescing, duplicate recovery and acknowledgement no-draft behavior.
- [ ] Verify RED against current immediate per-message generation.
- [ ] Implement minimal deferred turn sealing and runtime wiring.
- [ ] Run webhook, route, runtime, DB-first and no-send tests; verify GREEN.
- [ ] Commit Task 7 files.

### Task 8: Align queue and metrics with meaningful turns

**Files:**
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts`
- Modify: `src/server/customer-service/metrics.ts`
- Modify: `src/server/customer-service/metrics.test.ts`
- Modify if labels change: `src/app/reply-assistant/metric-cards.ts`, `src/app/reply-assistant/metric-cards.test.ts`

**Interfaces:**
- Queue shows one item per meaningful turn through its representative legacy message.
- Metrics add raw event, staff event, sealed turn, aggregated fragment, suppressed acknowledgement and recovery counts; pilot total counts only pilot-bound turns.

- [ ] Add failing tests for one queue item from three fragments and meaningful-turn pilot totals.
- [ ] Verify RED because current metrics count raw messages.
- [ ] Implement turn-aware queries and additive metric fields.
- [ ] Run queue, metrics and UI tests; verify GREEN.
- [ ] Commit Task 8 files.

### Task 9: Build and run conversation-aware evaluation

**Files:**
- Create: `src/server/customer-service/fixtures/conversation-evaluation-cases.jsonl`
- Create: `src/server/customer-service/conversation-evaluation.test.ts`
- Create: `scripts/evaluate-customer-service-conversations.ts`
- Modify: `package.json`

**Interfaces:**
- Fixtures use synthetic conversation labels only and include expected turn, intent, gate and draft/suppression decisions.
- Evaluator reports retrieval, interpretation, unnecessary draft, leakage, bypass, acceptance, latency and cost.

- [ ] Add the failing evaluator test with all required multi-turn categories and privacy assertions.
- [ ] Verify RED until required categories and metrics are implemented.
- [ ] Add the de-identified fixture and deterministic evaluator.
- [ ] Run evaluation and assert cross-customer leakage and policy bypass are zero.
- [ ] Commit Task 9 files.

### Task 10: Full regression and candidate review

**Files:**
- Modify documentation only if verification evidence needs a durable report.

**Interfaces:**
- No Production deployment or environment mutation.

- [ ] Run all focused conversation tests and all customer-service tests.
- [ ] Run all Customer Service DB suites against an isolated `TEST_DATABASE_URL` with zero skips.
- [ ] Run unchanged 100-case text evaluation and compare Phase 3.3 baseline.
- [ ] Run `npm run knowledge:check`, `npm run typecheck`, `npm run lint`, and `npm run build`.
- [ ] Run privacy/secret, cross-customer, policy bypass and no-send scans/tests.
- [ ] Review the full diff for unrelated changes and create one clean candidate commit if all checks pass.
