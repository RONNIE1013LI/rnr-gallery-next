# Task 6 Fix Round 1 Implementer Report

## Scope

Task 6 only. No Task 7 email work, Production configuration, Meta callback, Payment Requests, prompt, Policy Gate, or sending changes.

## RED evidence

- Non-Vercel spoofed proxy headers were accepted by the production IP resolver.
- A database `rate_limited` result occurred after `ensureWebsiteSession`, creating a session before the 429 response.
- A sealed completed website turn blocked a later turn.
- One-in-flight rejection rolled back all rate bucket increments.
- Website budget scope selection trusted caller-supplied channel.
- Website warning configuration had no durable state.
- The clean database warning test initially failed against the old global budget table, confirming the new durable website warning store was required.

## Fixes

- Public POST admission now defers conversation/session creation until rate-limit admission succeeds.
- Duplicate idempotency is checked before rate accounting.
- Rate counters commit when one-in-flight rejects; rejected first requests create no session or conversation and receive no cookie.
- A network-blocked new session does not create per-session bucket rows, preventing uncookied storage amplification.
- Only `pending`/`running` turns block a new website turn; completed/cancelled turns do not.
- Provider reservation derives channel from the persisted message.
- Global and website budgets are locked and reserved atomically in separate global/website state tables.
- Website warning crossing is persisted without blocking provider reservation.
- Production IP resolution uses only Vercel-overwritten `x-vercel-forwarded-for`, fails closed outside Vercel, and accepts no body/raw-IP input.
- Migration 0046 is additive-only and creates `customer_service_website_budget_state`.

## GREEN evidence

- Focused unit/API: 43/43 PASS.
- Focused Task 6 DB: 15/15 PASS.
- Full Customer Service plus related API/schema: 820/820 PASS, zero skipped.
- Full customer-service repository DB suite: 85/85 PASS, zero skipped.
- Clean isolated PostgreSQL 16 migration runner: PASS from an empty dedicated test database.
- TypeScript: PASS.
- ESLint: PASS with three pre-existing unused-parameter warnings and zero errors.
- Drizzle schema check: PASS.
- `git diff --check`: PASS.

## Concurrency and idempotency coverage

- Final session-minute allowance race.
- Final website budget allowance race.
- Final global budget allowance race.
- Completed-turn allowance.
- Duplicate message bucket counts remain one.
- Concurrent duplicate message admissions are serialized before rate accounting; one message and one set of bucket increments remain.
- Session minute/hour/total and network minute/hour limits tested independently.
- First-request rejection leaves no session/conversation.
- Budget block causes zero provider invocation.

## Risk

- The isolated test database is local and disposable; Staging still needs its normal migration/deployment validation.
- ESLint retains three unrelated baseline warnings outside Task 6.

## Controller follow-up RED/GREEN

- RED: two concurrent requests with the same website message key persisted one message but incremented rate buckets twice.
- GREEN: a transaction-scoped advisory lock now serializes duplicate admission before rate accounting; the focused Task 6 DB set passed 14/14.
