# R&R AI Reply Assistant Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared GPT-5.6 Sol-quality R&R AI Brain for Meta and Website Chat, with no Neon dependency in the ordinary Meta reply hot path and no regression to Website Chat or Phase 3.4 safety boundaries.

**Architecture:** A database-agnostic `RnrAiBrain` consumes channel-provided full conversation context, a deterministic Business Brain, validated images and narrow read-only tools. Meta uses Graph history plus an atomic non-Neon runtime store for control/dedupe/takeover/backlog; Website keeps its current Neon-backed session and transactional publication boundary. Meta auto-send is a separate, disabled boundary.

**Tech Stack:** Next.js 16, TypeScript, Vitest, Zod, OpenAI Responses API, Meta Graph API, existing Drizzle/PostgreSQL read-only business services, existing Phase 3.4 image validation, and a dedicated Redis-compatible runtime store.

**Spec:** `docs/superpowers/specs/2026-09-04-rnr-ai-reply-assistant-phase2-design.md`

## Global Constraints

- Re-read `docs/superpowers/specs/2026-09-04-rnr-ai-reply-assistant-audit.md`; fetch `origin/main --prune` before implementation and reconcile drift.
- Do not create, edit, rename, renumber or run a migration while the migration freeze remains active.
- This plan authorizes no Production deploy, platform change or environment change.
- Missing/invalid `RNR_AI_MASTER_ENABLED`, `RNR_META_AUTO_SEND_ENABLED`, or `RNR_WEBSITE_SHARED_BRAIN_ENABLED` means false.
- Missing/invalid `RNR_AI_ENGINE_MODE` means `legacy`.
- Preserve current Website origin/session/identity/rate-limit/structured-decision/renderer-proof/race/publication protections.
- Preserve the Meta 256 KiB limit, HMAC signature, Page ownership, identifier hashing and Phase 3.4 image restrictions.
- `RnrAiBrain` must not import Drizzle, `getDatabase`, Meta send code, Website publication code or runtime-store implementations.
- Ordinary Meta replies must not access any `customer_service_*` table or product registry.
- Live order/payment/dynamic-shipping facts use narrow read-only tools and fail closed.
- Do not alter prices, shipping, payment/order behavior or policy. `REVIEW` facts remain non-autonomous.
- OpenAI uses exact model `gpt-5.6-sol`, `store:false`, strict output and no silent model fallback.
- Never log tokens, raw/hashes of customer identifiers, click IDs, attachment source/bytes, full prompts or response bodies.
- Do not create public customer-image URLs or persist customer images in Neon.

## Locked file structure

Shared core:

- `src/server/rnr-ai/types.ts`
- `src/server/rnr-ai/brain.ts`
- `src/server/rnr-ai/context/assembler.ts`
- `src/server/rnr-ai/risk/risk-gate.ts`
- `src/server/rnr-ai/providers/openai-sol.ts`
- `src/server/rnr-ai/business-brain/*`
- `src/server/rnr-ai/tools/*`

Meta and runtime state:

- `src/server/rnr-ai/meta/{config,types,instagram-adapter,context-provider,graph-context-provider,image-resolver,review-payload-protector,orchestrator,human-takeover,backlog-reconciler,reply-sender,runtime}.ts`
- `src/server/rnr-ai/runtime-store/{reply-runtime-store,in-memory-reply-runtime-store,redis-reply-runtime-store}.ts`

Website/Admin adapters:

- `src/server/rnr-ai/website/website-brain-adapter.ts`
- `src/app/api/reply-assistant/control/*`
- `src/app/api/reply-assistant/meta-reviews/*`
- `src/app/api/reply-assistant/conversations/[conversationKey]/takeover/*`
- `src/app/api/internal/reply-assistant/meta-runtime/*`

No `src/server/db/schema` or `drizzle/` file is part of this plan.

---

### Task 1: Lock current safety and rollout defaults

**Files:**
- Create: `src/server/rnr-ai/current-boundary-regression.test.ts`
- Modify: `src/server/customer-service/no-auto-send.test.ts`
- Reference: current Meta, Website and runtime files

**Interfaces:** Produces source guards used by every later task.

- [ ] Write a failing test importing `parseRnrAiMetaConfig` and asserting `{masterEnabled:false, engineMode:"legacy", metaAutoSendEnabled:false, websiteSharedBrainEnabled:false}` for an empty env.
- [ ] Extend `no-auto-send.test.ts` so Graph `/messages` can appear only inside `src/server/rnr-ai/meta/reply-sender.ts`, and only behind an exact auto-send guard.
- [ ] Run `npm run test:run -- src/server/rnr-ai/current-boundary-regression.test.ts`; expect unresolved `./meta/config`.
- [ ] Record the legacy baseline with the existing Meta adapter/webhook, engine, recovery, no-auto-send, Website publication/messages/updates suites.
- [ ] Commit with `git commit -m "test: lock reply assistant migration boundaries"`.

### Task 2: Compile Business Brain v0.5.1

**Files:**
- Create: `src/server/rnr-ai/business-brain/rnr-business-brain.v0.5.1.json`
- Create: `src/server/rnr-ai/business-brain/{schema,loader}.ts`
- Create: `src/server/rnr-ai/business-brain/compiled-business-brain.json`
- Create: `scripts/compile-rnr-business-brain.ts`
- Create: `scripts/compile-rnr-business-brain.test.ts`
- Modify: `package.json`, lockfile

**Interfaces:** Produces `loadBusinessBrain(): CompiledBusinessBrain` and `business-brain:build/check`.

- [ ] Encode the supplied v0.5.1 facts with stable source IDs, market, provenance, `CONFIRMED|REVIEW`, risk and live-tool requirement; keep all eleven owner-review entries as `REVIEW` without inventing values.
- [ ] Write failures for duplicate IDs, mixed NZ/AU currency, invalid version/date, missing provenance, `REVIEW` marked autonomous, and historical examples overriding hard facts.
- [ ] Run `npm run test:run -- scripts/compile-rnr-business-brain.test.ts`; expect missing compiler failure.
- [ ] Implement deterministic Zod compile output:

```ts
type CompiledBusinessBrain = Readonly<{
  version: "0.5.1";
  effectiveDate: "2026-09-04";
  sourceSha256: string;
  rules: readonly BusinessRule[];
  riskRules: readonly RiskRule[];
  voice: VoiceGuide;
  reviewItems: readonly string[];
}>;
```

- [ ] Add `business-brain:build` and `business-brain:check`; hash normalized source and sort by stable IDs.
- [ ] Run build twice, verify no second diff, then run both `business-brain:check` and existing `knowledge:check`.
- [ ] Commit with `git commit -m "feat: compile canonical R&R business brain"`.

### Task 3: Add shared types and complete-context assembly

**Files:**
- Create: `src/server/rnr-ai/types.ts`
- Create: `src/server/rnr-ai/context/assembler.ts`
- Create: `src/server/rnr-ai/context/assembler.test.ts`

**Interfaces:** Produces `RnrAiRequest`, `RnrAiDecision`, `ConversationTurn`, `VerifiedImageInput`, and `assembleConversationContext()`.

- [ ] Test chronological ordering, provider-key dedupe, adjacent customer-fragment merge, staff-role preservation, latest-turn verbatim retention, deterministic old-turn compaction, and `incompleteMaterialContext`.
- [ ] Run `npm run test:run -- src/server/rnr-ai/context/assembler.test.ts`; expect missing module.
- [ ] Implement immutable request/decision types exactly as the design; conversation turns contain sanitized text, role, timestamp, hashed message key and attachment ordinals only.
- [ ] Implement a 60,000-character model budget: every available turn is considered; latest turns remain verbatim; material price/deadline/policy/payment facts remain verbatim or mark context incomplete.
- [ ] Verify `turnsConsidered` equals source turn count and tests pass.
- [ ] Commit with `git commit -m "feat: add shared AI context contracts"`.

### Task 4: Add monotonic GREEN/YELLOW/RED gating

**Files:**
- Create: `src/server/rnr-ai/risk/risk-gate.ts`
- Create: `src/server/rnr-ai/risk/risk-gate.test.ts`
- Modify through compatibility exports only: `src/server/customer-service/policy-gate.ts`, `output-validator.ts`

**Interfaces:** Produces `evaluateFinalRisk(input): FinalRiskDecision`.

- [ ] Add table tests for all supplied risk categories, `REVIEW`, incomplete context, tool failure, unsupported claim and attempted model downgrade.
- [ ] Assert `RED + model GREEN => RED/autoReplyEligible:false` and `YELLOW + model GREEN => YELLOW/false`.
- [ ] Run the test and expect missing implementation.
- [ ] Implement ordinal maximum `GREEN=0`, `YELLOW=1`, `RED=2` across deterministic, knowledge, tool, model, output and channel risk.
- [ ] Adapt current commitment, monetary and policy-leak checks without changing legacy exports.
- [ ] Run new risk plus existing policy/output regression suites.
- [ ] Commit with `git commit -m "feat: add monotonic reply risk gate"`.

### Task 5: Add the Sol multimodal provider

**Files:**
- Create: `src/server/rnr-ai/providers/openai-sol.ts`
- Create: `src/server/rnr-ai/providers/openai-sol.test.ts`
- Reference: current text and image OpenAI providers

**Interfaces:** Produces `OpenAiSolProvider.generate(request): Promise<SolStructuredResult>`.

- [ ] Test exact `gpt-5.6-sol`, `store:false`, strict JSON schema, `reasoning.effort:"medium"`, 25-second timeout, text/image order, usage parsing and absence of secret/body logs.
- [ ] Run test and expect missing provider.
- [ ] Implement text plus validated in-memory JPEG/PNG/WebP input; reject invalid/non-2xx/empty/schema-mismatched output and never use `previous_response_id`.
- [ ] Classify `configuration`, `timeout`, `transient_transport`, `rate_limited`, `invalid_output`, `permanent_provider`; retry timeout/reset/408/429/5xx once before any usable result.
- [ ] Run new provider plus existing OpenAI provider tests.
- [ ] Commit with `git commit -m "feat: add structured Sol reply provider"`.

### Task 6: Add narrow read-only business tools

**Files:**
- Create: `src/server/rnr-ai/tools/{types,tool-registry,product-price-tool,shipping-tool,order-status-tool,payment-status-tool}.ts`
- Create: `src/server/rnr-ai/tools/tool-registry.test.ts`

**Interfaces:** Produces `BusinessToolRegistry.execute(request): Promise<ToolEvidence>`.

- [ ] Test an exact allowlist: `canonical_product_price`, `dynamic_shipping_quote`, `order_status`, `payment_status`; reject arbitrary operations, incomplete shipping input and identity-free private lookups.
- [ ] Run test and expect missing modules.
- [ ] Resolve confirmed canonical prices from `CompiledBusinessBrain` without Neon; return `unavailable_review_required` for `REVIEW` entries.
- [ ] Wrap current shipping/order/payment reads behind injected, read-only DTO adapters; never expose database handles to the Brain.
- [ ] Add a static import test: only the three live adapters may import existing business/database services; Brain/context/provider/canonical price must not.
- [ ] Run tool registry and current pricing-source tests.
- [ ] Commit with `git commit -m "feat: add read-only AI business tools"`.

### Task 7: Add atomic non-Neon runtime state

**Prerequisite:** Owner approves/provisions the dedicated Redis-compatible store; do not substitute Neon.

**Files:**
- Create: `src/server/rnr-ai/control/types.ts`
- Create: `src/server/rnr-ai/runtime-store/{reply-runtime-store,in-memory-reply-runtime-store,redis-reply-runtime-store}.ts`
- Create: `src/server/rnr-ai/runtime-store/reply-runtime-store.contract.test.ts`
- Modify: `package.json`, lockfile

**Interfaces:**

```ts
interface ReplyRuntimeStore {
  readControl(): Promise<AiControlSnapshot>;
  compareAndSetControl(expectedRevision: number, next: AiControlConfig): Promise<boolean>;
  claimEvent(keyHash: string, leaseMs: number): Promise<EventLease | null>;
  settleEvent(lease: EventLease, result: EventResult): Promise<void>;
  readTakeover(conversationKeyHash: string): Promise<TakeoverState | null>;
  setTakeover(input: TakeoverMutation): Promise<void>;
  claimDelivery(key: string, leaseMs: number): Promise<DeliveryLease | null>;
  settleDelivery(lease: DeliveryLease, result: DeliveryResult): Promise<void>;
  enqueueBacklog(controlRevision: number, window: TimeWindow): Promise<boolean>;
  putEncryptedReview(key: string, ciphertext: string, ttlSeconds: 172800): Promise<void>;
  listReviewMetadata(limit: number): Promise<readonly ReviewMetadata[]>;
  readEncryptedReview(key: string): Promise<string | null>;
  deleteReview(key: string): Promise<void>;
}
```

Use these exact supporting records:

```ts
type AiControlSnapshot = Readonly<{ config: AiControlConfig; readAt: string }>;
type EventLease = Readonly<{ keyHash: string; leaseToken: string; expiresAt: string }>;
type EventResult = Readonly<{ status: "processed"|"review"|"delivery_candidate"|"failed"; settledAt: string }>;
type TakeoverState = Readonly<{ active: boolean; source: "staff_echo"|"admin"|"risk"; changedAt: string }>;
type TakeoverMutation = Readonly<{ conversationKeyHash: string; active: boolean; source: TakeoverState["source"]; changedAt: string }>;
type DeliveryLease = Readonly<{ key: string; leaseToken: string; expiresAt: string }>;
type DeliveryResult = Readonly<{ status: "sent"|"delivery_uncertain"|"blocked"; providerMessageIdMasked: string|null; settledAt: string }>;
type TimeWindow = Readonly<{ from: string; to: string; maxConversations: 100 }>;
type ReviewMetadata = Readonly<{ key: string; conversationKeyHash: string; risk: "YELLOW"|"RED"; createdAt: string; expiresAt: string }>;
```

- [ ] Write one contract suite for both adapters: 20 concurrent claims yield one winner; stale lease recovers; control CAS conflicts; takeover is sticky; duplicate backlog enqueue is false; terminal delivery cannot replay; encrypted review data expires after exactly 48 hours under an injected clock.
- [ ] Assert serialized records contain no raw message, attachment URL/bytes, PSID, email or phone; keys use HMAC hashes only.
- [ ] Run test and expect missing adapters.
- [ ] Implement injected-clock in-memory adapter for tests only.
- [ ] Add `@upstash/redis` and implement Redis CAS/claim with Lua or a single atomic command; terminal dedupe is 30 days, leases bounded, takeover/control durable.
- [ ] Missing credentials, timeout, invalid response or store error must make AI effective OFF; never fall back to process memory.
- [ ] Run contract tests against memory and an explicitly non-Production Redis namespace.
- [ ] Commit with `git commit -m "feat: add non-Neon reply runtime state"`.

### Task 8: Add fail-closed AI Control and Admin API

**Files:**
- Modify: `src/server/rnr-ai/control/types.ts`
- Create: `src/server/rnr-ai/control/schedule.ts`
- Create: `src/server/rnr-ai/control/schedule.test.ts`
- Create: `src/server/rnr-ai/meta/{config,config.test}.ts`
- Create: `src/app/api/reply-assistant/control/{route,route-handler,route-handler.test}.ts`

**Interfaces:** Produces `evaluateAiControl(snapshot, now)` and protected control GET/POST.

- [ ] Test ON/OFF/SCHEDULE, missing store/env, invalid values, NZST/NZDT transitions, overnight periods, next transition, expired override and master-kill precedence.
- [ ] Implement exact state:

```ts
type AiControlConfig = Readonly<{
  revision: number;
  mode: "ON" | "OFF" | "SCHEDULE";
  timezone: "Pacific/Auckland";
  periods: readonly { day: 0|1|2|3|4|5|6; start: string; end: string }[];
  override: null | { state: "ON"|"OFF"; expiresAt: string; actorUserId: string };
}>;
```

- [ ] Evaluate with `Intl.DateTimeFormat` and fixed IANA timezone; ambiguous/invalid state is OFF. Override cannot bypass the master kill switch.
- [ ] Protect routes with `requireAdminPermission("use_reply_assistant")`, trusted-origin mutation check, strict bounded JSON and control revision CAS.
- [ ] Require FORCE_ON/FORCE_OFF expiry; repeated identical mutation is idempotent; committed OFF→ON enqueues one backlog revision.
- [ ] Run schedule/config/API/auth tests.
- [ ] Commit with `git commit -m "feat: add Auckland AI control gate"`.

### Task 9: Add Meta full-history and common channel events

**Files:**
- Create: `src/server/rnr-ai/meta/{types,context-provider,graph-context-provider}.ts`
- Create: `src/server/rnr-ai/meta/graph-context-provider.test.ts`
- Modify: `src/server/customer-service/adapters/facebook.ts` and test
- Create: `src/server/rnr-ai/meta/instagram-adapter.ts` and test; keep its runtime route disabled if Facebook-only scope is approved

**Interfaces:** Produces `MetaContextProvider.loadConversation(): Promise<MetaConversationSnapshot>`.

- [ ] Add sanitized real-shaped fixtures for Page/Instagram customer message, staff outbound, reply-to, image, pagination, duplicate mid and ignored read/delivery/reaction.
- [ ] Preserve Facebook behavior; map a separate Instagram normalizer to common `MetaConversationEvent` only if owner includes it in first scope.
- [ ] Implement paginated Graph reads for message ID, role, time, text and attachment metadata only; stop at start/provider retention or 500 turns/60,000 characters.
- [ ] Return `complete:false` on truncation, permission or pagination gap so material cases cannot be GREEN.
- [ ] Use server-only credentials, Graph-origin validation and request timeouts; never log token, raw response, PSID or full text.
- [ ] Run Facebook adapter and Graph-provider tests.
- [ ] Commit with `git commit -m "feat: add Meta full conversation provider"`.

### Task 10: Wire Phase 3.4-safe image input

**Files:**
- Create: `src/server/rnr-ai/meta/image-resolver.ts` and test
- Modify only for injected compatibility: existing attachment protector, source reader and validation files

**Interfaces:** Produces `resolveMetaImages(event): Promise<readonly VerifiedImageInput[]>`.

- [ ] Test encrypted source, 15-minute TTL, HTTPS allowlist, DNS rebinding/private IP, redirects, MIME spoof, count/byte/batch/pixel/side/time limits, abort cleanup, and zero Blob/Neon writes/log leakage.
- [ ] Run test and expect missing resolver.
- [ ] Compose existing source protector, Facebook reader and validator; put ciphertext only in runtime store; download/validate in memory; delete source in `finally`.
- [ ] Return typed `image_review_required` when any relevant image fails; never send a generic answer that ignores the image.
- [ ] Run resolver and all existing attachment/security regression tests.
- [ ] Commit with `git commit -m "feat: add protected Meta image input"`.

### Task 11: Implement `RnrAiBrain`

**Files:**
- Create: `src/server/rnr-ai/brain.ts` and test
- Create: `src/server/rnr-ai/fixtures/{business-brain-evaluation,conversation-context-evaluation,risk-evaluation}.jsonl`
- Create: `scripts/evaluate-rnr-ai-brain.ts`
- Modify: `package.json`

**Interfaces:** Consumes shared request/Brain/provider/tools; produces `RnrAiDecision`.

- [ ] Test direct answer first, no repeated known questions, NZ/AU separation, multi-part answer, max two tool calls, image use, `REVIEW` hold, unsupported-claim rejection and zero database imports.
- [ ] Implement fixed order: context → deterministic pre-risk → confirmed Brain rules → allowlisted tools → Sol → supported-claim validation → monotonic final risk.
- [ ] Delimit customer data as JSON; tool outputs include source/timestamp; customer content cannot define instructions, tools or knowledge.
- [ ] Add at least 40 synthetic evaluations covering every target behavior, multi-turn context, image relevance, prompt injection and all risk levels.
- [ ] Make evaluator fail on any RED auto-eligible result, wrong currency or unsupported price/policy claim; require 100% currency correctness.
- [ ] Run Brain unit and evaluation suites.
- [ ] Commit with `git commit -m "feat: add shared R&R AI brain"`.

### Task 12: Add Meta orchestrator, takeover and backlog without sending

**Files:**
- Create: `src/server/rnr-ai/meta/orchestrator.ts` and `orchestrator.test.ts`
- Create: `src/server/rnr-ai/meta/human-takeover.ts` and `human-takeover.test.ts`
- Create: `src/server/rnr-ai/meta/backlog-reconciler.ts` and `backlog-reconciler.test.ts`
- Create: `src/server/rnr-ai/meta/review-payload-protector.ts` and `review-payload-protector.test.ts`
- Create: `src/server/rnr-ai/meta/runtime.ts`

**Interfaces:** Produces `MetaReplyOrchestrator.handle()`, `HumanTakeoverService`, `BacklogReconciler.run()`.

- [ ] Write OFF tests with spies for Graph, images, Brain, tools, Drizzle and sender; every spy remains zero and webhook result is acknowledged.
- [ ] Test duplicate mid, 20 concurrent calls, staff echo before/after model, explicit takeover/release, newer customer message and control switching OFF before candidate.
- [ ] Test one backlog per control revision; 24-hour/100 cap; latest consecutive customer merge; skip later staff reply, takeover, processed key and old history; stop immediately on OFF.
- [ ] Implement pre-model and pre-candidate control/takeover/latest-message checks. YELLOW/RED creates human-review/takeover state; GREEN creates `delivery_candidate_disabled` while send is false.
- [ ] Encrypt YELLOW/RED review text and reason with AES-256-GCM before a 48-hour runtime-store write; decryption is server-only and storage failure means takeover/no-send.
- [ ] Verified human staff echo activates sticky takeover; sender-originated echo reconciles by provider message ID and is not mislabeled human.
- [ ] Add static test rejecting `getDatabase`, `drizzle`, `customer_service_` and product registry imports in this runtime.
- [ ] Run all three suites and commit with `git commit -m "feat: orchestrate no-Neon Meta replies"`.

### Task 13: Split secure Meta ingress from legacy runtime

**Files:**
- Modify: `src/app/api/meta/webhook/route-handler.ts` and test
- Modify: `src/server/customer-service/meta/webhook-handler.ts` and test
- Modify: `src/server/customer-service/runtime.ts`
- Create: `src/app/api/internal/reply-assistant/meta-runtime/{route,route-handler,route-handler.test}.ts`
- Modify only in later approved release: `vercel.json`

**Interfaces:** Produces signed webhook ACK independent of AI state and protected recovery entry.

- [ ] Test matrix: bad signature 401; wrong Page 403; declared/chunked oversize 413; valid+OFF 200/zero work; legacy unchanged; shadow no-send; invalid mode legacy; store failure 200/no AI.
- [ ] Refactor handler so security and normalization precede an injected `onAcceptedEvent`; the handler never constructs Drizzle.
- [ ] Select legacy/shared in route wiring. Shared runtime is constructed only after valid request and control evaluation.
- [ ] Add constant-time Bearer `CRON_SECRET` worker; reclaim stale non-Neon leases and one backlog page; OFF performs zero Graph/OpenAI/send work.
- [ ] Plan a 10-minute `vercel.json` cadence only after route tests pass; do not deploy it under Phase 2 design work.
- [ ] Run Meta route/webhook/worker/no-auto-send tests.
- [ ] Commit with `git commit -m "refactor: separate Meta ingress from AI execution"`.

### Task 14: Add Admin control and per-conversation takeover UI

**Files:**
- Modify: `src/app/reply-assistant/page.tsx`
- Modify: `src/app/reply-assistant/page.test.tsx`
- Modify: `src/app/reply-assistant/live-dashboard.tsx`
- Modify: `src/app/reply-assistant/live-dashboard.test.tsx`
- Modify: `src/app/reply-assistant/reply-assistant.module.css`
- Modify: `src/components/reply-assistant/reply-assistant-client.tsx`
- Modify: `src/components/reply-assistant/reply-assistant-client.test.tsx`
- Create: `src/app/api/reply-assistant/conversations/[conversationKey]/takeover/{route,route-handler,route-handler.test}.ts`
- Create: `src/app/api/reply-assistant/meta-reviews/{route,route-handler,route-handler.test}.ts`
- Create: `src/app/api/reply-assistant/meta-reviews/[reviewKey]/{route,route-handler,route-handler.test}.ts`

**Interfaces:** Consumes protected control/takeover APIs; produces operator controls.

- [ ] Test ON/OFF/SCHEDULE display, `Pacific/Auckland`, next transition, expiring override, store-unavailable OFF, revision conflict, takeover/release, permissions and no secret/raw identifier exposure.
- [ ] Implement compact existing-style controls; FORCE actions require confirmation and exact expiry. Use existing safe HMAC/selector, never PSID.
- [ ] List only non-sensitive review metadata; decrypt the 48-hour review payload only in the protected detail handler after `use_reply_assistant` authorization and return `no-store` responses.
- [ ] Keep explicit Refresh/action behavior; do not add timer/focus/visibility polling.
- [ ] Run page/component/route tests, changed-file ESLint and local browser checks at 390/768/1280 widths.
- [ ] Commit with `git commit -m "feat: add Reply Assistant control and takeover UI"`.

### Task 15: Adapt Website Chat behind its own flag

**Files:**
- Create: `src/server/rnr-ai/website/website-brain-adapter.ts` and test
- Modify: `src/app/api/customer-chat/messages/route-handler.ts` and test
- Modify: `src/server/customer-service/website/structured-decision.ts`
- Modify for injected selection only: `src/server/customer-service/engine.ts`, `runtime.ts`
- Preserve behavior: `src/server/customer-service/website/publication.ts`

**Interfaces:** Produces the current `WebsiteDecision`/attempt shape needed by `publishWebsiteValidatedAi()`.

- [ ] With flag false/missing, assert identical route result and repository/publication calls.
- [ ] With flag true, assert shared output still passes local structured mapping, renderer proof and transactional publication.
- [ ] Retain Guest/User A/User B isolation, expired-session rejection, identity/rate limit, newer-turn cancellation, human-wins, duplicate-publication and human-review fallback tests.
- [ ] Load the full authorized Website transcript through the repository adapter; map GREEN into existing safe decision types and YELLOW/RED to `HUMAN_REVIEW_REQUIRED`; never publish raw Brain text.
- [ ] Run all Website route/publication/update/session/identity/security suites in legacy and shared selection.
- [ ] Commit with `git commit -m "feat: adapt Website Chat to shared AI brain"`.

### Task 16: Add but do not activate Meta sender boundary

**Files:**
- Create: `src/server/rnr-ai/meta/reply-sender.ts` and test
- Modify: `src/server/rnr-ai/meta/runtime.ts`
- Modify: `src/server/customer-service/no-auto-send.test.ts`

**Interfaces:** Produces `MetaReplySender.sendEligibleReply(candidate)` for a later approved phase.

- [ ] Test zero Graph calls for every missing/false flag, non-GREEN, takeover, latest mismatch, terminal key, missing credential and uncertain prior delivery.
- [ ] Test 20 concurrent calls → one Graph POST; provider message ID settlement; echo reconciliation; timeout after possible send → `delivery_uncertain`; no blind retry.
- [ ] Isolate the only Meta `/messages` POST in `reply-sender.ts`; immediately recheck control, takeover and latest conversation before send.
- [ ] Stable key: `meta-reply:<channel>:<conversation-hash>:<latest-message-hash>:<brain-version>`; store only hashes/status/timestamps/masked provider ID.
- [ ] Phase 2 runtime injects `DisabledMetaReplySender`. Construct real sender only when master true, mode `shared_active`, and auto-send true.
- [ ] Run sender/no-auto-send/config/orchestrator suites.
- [ ] Commit with `git commit -m "feat: add disabled Meta sender boundary"`.

### Task 17: Full validation and rollout runbook, no deployment

**Files:**
- Modify: `scripts/test-support/audit-reply-assistant-privacy.ts`
- Modify: `src/server/customer-service/security-regression.test.ts`
- Modify: `src/server/customer-service/serverless-compatibility.test.ts`
- Create: `docs/releases/2026-09-04-rnr-ai-reply-assistant-phase2-validation.md`
- Create: `docs/releases/2026-09-04-rnr-ai-reply-assistant-rollout-runbook.md`

**Interfaces:** Produces evidence and exact later rollback states; does not deploy.

- [ ] Add privacy/static failures for secret/body/image logging, DB imports in ordinary Meta runtime, unguarded Graph POST, public client import of server modules and any schema/migration diff.
- [ ] Run `business-brain:check`, `knowledge:check`, new Brain evaluation, existing conversation/Website/image evaluations and all scoped R&R AI/customer-service/API/Admin suites.
- [ ] Run full verification:

```bash
npm run test:run
npm run typecheck
npm run lint
npm run db:check
npm run build
git diff --check
```

- [ ] Independently review OFF zero-call, no-Neon boundary, context completeness, image SSRF/privacy, risk downgrade, live-tool authorization, takeover races, backlog replay, outbound duplication/uncertainty and Website publication bypass.
- [ ] Record exact test/evaluation counts, HEAD, `origin/main`, flags, no migration/schema diff and owner prerequisites; never include secrets/customer data.
- [ ] Write rollout order: offline → shadow → Admin comparison → Website canary → Meta draft → control/backlog dry run → Meta test recipient → separate owner approval → future-only GREEN auto-send.
- [ ] Record rollback states: master false; Website flag false; Meta send false; engine `legacy`. Prove no replay-all path exists.
- [ ] Commit validation/runbook only after evidence; do not merge or deploy.

## Implementation review gates

Every task gets an independent review before the next. Task 7 requires owner-approved non-Neon storage. Task 16 does not authorize sending. Task 17 ends with a reviewable branch and runbook, not a merge or deploy.

Before any future merge: fetch/prune `origin/main`, reconcile current Reply Assistant/Website/Meta changes, rerun Task 17, verify no migration/schema diff, and follow the guarded `origin/main` release path only under separate approval.

## Owner inputs required before dependent implementation

- Dedicated Redis-compatible runtime store provisioning/cost.
- Initial Pacific/Auckland weekly schedule and maximum override duration.
- Backlog limit approval: recommended 24 hours and 100 conversations.
- Facebook-only versus Facebook plus Instagram Direct initial scope and later Meta permissions.
- Confirmed values for Business Brain `REVIEW` items; unresolved items remain YELLOW/RED and do not block unrelated GREEN cases.
- Website image upload is excluded unless separately approved; Meta images are included.

## Plan stop statement

This document is a plan only. No task was executed while writing it. Production behavior, deployments, databases, migrations, Meta settings, auto-send, prices, shipping, payment/order logic and policies remain unchanged.
