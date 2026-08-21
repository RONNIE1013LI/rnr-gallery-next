# Facebook Customer Display Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve and display sanitized Facebook customer names through a least-privilege, server-only GET profile lookup without weakening no-send or privacy controls.

**Architecture:** Extend the existing conversation row with cached UI-only profile fields and repository CAS methods. Resolve a raw PSID only inside the current webhook request after message persistence, then publish an existing queue-conversation live update. The Customer Service Engine, prompt, learning data, and client never receive the raw PSID or token.

**Tech Stack:** Next.js Route Handlers, TypeScript, Drizzle ORM, PostgreSQL, Vitest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-21-facebook-customer-display-names-design.md`

## Global Constraints

- Production, Production Meta callback, Customer Service Engine, Policy Gate, Output Validator, Continuous Learning, Case Memory, and send capability remain unchanged.
- Only `first_name` and `last_name`; no `profile_pic`.
- Raw PSID persistence, logs, browser exposure, prompt exposure, and learning-data exposure must remain zero.
- Profile lookup failure must never block webhook 200, persistence, conversation processing, or AI draft generation.
- Staging is blocked if the lookup token has `pages_messaging` or any sending capability.

---

### Task 1: Add Cached Profile State With Repository CAS

**Files:**
- Modify: `src/server/db/schema/customer-service.ts`
- Modify: `src/server/customer-service/repositories/customer-service-repository.ts`
- Modify: `src/server/customer-service/repositories/drizzle-customer-service-repository.ts`
- Test: `src/server/db/schema/customer-service-schema.test.ts`
- Test: `src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts`
- Create: additive Drizzle migration generated from the schema

**Interfaces:**
- Produces: `claimFacebookProfileResolution(input)` and `completeFacebookProfileResolution(input)` repository methods.
- Produces: `customerDisplayName` on `SafeQueuePage` items.

- [ ] Write schema and integration tests proving cache reuse, expiry, concurrent CAS, two-customer isolation, and queue projection.
- [ ] Run those tests and confirm RED due to missing columns and methods.
- [ ] Add the four requested columns, checks/index, repository types, CAS claim, completion, and queue selection.
- [ ] Generate the additive migration and run schema/integration tests to GREEN.
- [ ] Commit the task.

### Task 2: Implement The Fixed Facebook Profile GET Resolver

**Files:**
- Create: `src/server/customer-service/facebook-profile/profile-resolver.ts`
- Create: `src/server/customer-service/facebook-profile/profile-resolver.test.ts`

**Interfaces:**
- Produces: `createFacebookProfileResolver({ token, fetchImpl, timeoutMs })` with `resolve(rawPsid)` returning `resolved`, `temporary_failure`, or `unavailable`.

- [ ] Write tests for success, Unicode-safe name sanitization, timeout/5xx/429, permission denial, malformed data, fixed GET method/path/fields, and absence of secret logging.
- [ ] Run the resolver test and confirm RED because the module does not exist.
- [ ] Implement only the predefined Graph GET using an Authorization header, strict response validation, and bounded timeout.
- [ ] Run resolver tests to GREEN.
- [ ] Commit the task.

### Task 3: Attach Fail-Soft Resolution To Customer Webhooks

**Files:**
- Modify: `src/server/customer-service/meta/webhook-handler.ts`
- Modify: `src/server/customer-service/meta/webhook-handler.test.ts`
- Modify: `src/app/api/meta/webhook/route.ts`

**Interfaces:**
- Consumes: repository claim/completion methods and the fixed resolver.
- Produces: customer-only, post-persistence profile resolution in the current request lifecycle.

- [ ] Write tests for success, old-conversation backfill, failure fallback, staff echo exclusion, duplicate/concurrent events, resolver OpenAI calls zero, and persistence-before-lookup ordering.
- [ ] Run webhook tests and confirm RED.
- [ ] Inject the resolver separately from Customer Service configuration, claim by hashed identity, resolve before request completion, complete cache state, and swallow profile-only failures.
- [ ] Run webhook tests to GREEN.
- [ ] Commit the task.

### Task 4: Display One Conversation Name Source In The UI

**Files:**
- Modify: `src/components/reply-assistant/reply-assistant-client.tsx`
- Modify: `src/components/reply-assistant/reply-assistant-client.test.tsx`
- Modify: `src/app/reply-assistant/live-dashboard.test.tsx`

**Interfaces:**
- Consumes: `SafeQueuePage.items[].customerDisplayName`.

- [ ] Write tests proving card/timeline consistency, `Customer` fallback, live polling name update, editor preservation, and two-conversation isolation.
- [ ] Run UI tests and confirm RED.
- [ ] Render the same display-name value in the card and customer timeline labels without touching editor state.
- [ ] Run UI/live-update tests to GREEN.
- [ ] Commit the task.

### Task 5: Lock Privacy, No-Send, Migration, And Staging Evidence

**Files:**
- Modify: `.env.example`
- Modify: `src/server/customer-service/no-auto-send.test.ts`
- Modify: `src/server/customer-service/security-regression.test.ts`
- Add focused tests only where a missing invariant requires them.

**Interfaces:**
- Produces: a disabled-by-default, server-only `FACEBOOK_PROFILE_LOOKUP_TOKEN` configuration and final candidate evidence.

- [ ] Add RED static/runtime tests proving no raw PSID storage/client exposure, no display name in AI/learning inputs, arbitrary PSID lookup unavailable, no Graph POST/send code, and token isolation.
- [ ] Add the minimal server-only environment wiring and make all tests GREEN.
- [ ] Run focused tests, all Customer Service tests, DB tests with zero skips, typecheck, ESLint, build, privacy/secret scan, and no-send scan.
- [ ] Deploy only to Preview, inspect real token scopes, and stop if sending capability is present.
- [ ] On an approved Test Page, verify one lookup per customer, cache reuse, live UI update, cross-customer leakage zero, resolver OpenAI calls zero, and no-send PASS.
- [ ] Create the candidate commit and report Staging READY or NOT READY from actual evidence.
