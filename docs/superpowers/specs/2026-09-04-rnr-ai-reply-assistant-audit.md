# R&R Gallery AI Reply Assistant — Phase 1 Audit

**Audit date:** 2026-09-04 (Pacific/Auckland)  
**Authoritative source baseline:** `origin/main` at `081fc825b5e3574c85ef674082bce41ff2f8e1bf`  
**Audit branch:** `audit/rnr-ai-reply-assistant-phase1-20260904`  
**Scope:** source/history inspection and safe local tests only. No Production data was queried or changed.

## Executive findings

1. The current Facebook Reply Assistant is a **Neon-backed, human-review-only drafting system**. Neon is mandatory before the webhook can persist a message, before a turn can be claimed, before OpenAI can be called, and after generation can be completed.
2. The Facebook path does **not** contain a Messenger Send API client, Page access token, or automatic outbound action. A generated draft reaches Meta only when a staff member copies it into Meta Business Suite and later records `sent_confirmed` manually.
3. The current text model integration calls the OpenAI Responses API directly with `fetch`. The source default is `gpt-5.6-luna`; an `OPENAI_MODEL` environment value can override it. The exact Production override was not read during this audit.
4. The model receives at most the latest **six** same-conversation customer/staff context items, not the full conversation.
5. Current Facebook image events are deliberately terminal human-review cases. The webhook discards the raw image URL before persistence, does not schedule a vision provider, and actual image bytes/URLs do not reach the model.
6. The only current AI controls are environment flags plus a DB-backed bounded pilot. There is no admin `ON / OFF / SCHEDULE` control, no per-conversation AI pause, no smart backlog mode, and no Auckland-time schedule evaluator.
7. `OFF` currently makes the Meta webhook return `503`; therefore it also stops normal message ingestion. That does not meet the future requirement that Meta messages may continue to arrive while Reply Assistant AI work remains fully off.
8. The current Meta normalizer accepts only `object === "page"`. A distinct Instagram webhook object is not handled by this path; Instagram Direct support is therefore not demonstrated by current code.
9. Website Chat reuses the same repository, engine, knowledge, policy and OpenAI provider, but has separate session/identity/rate-limit controls and a guarded website-only publication path. A shared-engine replacement must not weaken those Website Chat controls.
10. The attached **R&R Gallery Business Brain v0.5.1** is a future canonical target/reference, not the artifact loaded by the current runtime. Current runtime knowledge is `compiled-knowledge.json`, compiled on 2026-08-20 from source commit `15c5d55...`.

## 1. Current Architecture Diagram

```mermaid
flowchart TD
  Meta[Meta Page messaging webhook] --> Route[POST /api/meta/webhook]
  Route --> Guard[256 KiB guard + HMAC signature + Page ID check]
  Guard --> Adapter[Facebook adapter: object=page / message / is_echo]
  Adapter --> Hash[HMAC sender, conversation and message identifiers]
  Hash --> Ingest[Neon transaction: event, message, turn, identity]
  Ingest -->|customer text, no attachment| After[Next.js after() + 2s debounce]
  Ingest -->|attachment| HumanImage[terminal human_review_required]
  Ingest -->|staff is_echo| HumanEcho[store human outbound + suppress matching turn]
  After --> Claim[Neon seal + active pilot + atomic turn lease]
  Cron[Vercel cron every 30 min] --> Claim
  Claim --> Context[Neon: latest 6 context items + attachment check]
  Context --> State[conversation state + intent]
  State --> Policy[policy/realtime/high-risk gate]
  Policy -->|allowed| Knowledge[compiled knowledge + optional approved case memory]
  Knowledge -->|price question only| Registry[Neon product_registry_current]
  Knowledge --> Reserve[Neon attempt + budget reservation]
  Registry --> Reserve
  Reserve --> OpenAI[OpenAI Responses API]
  OpenAI --> Validate[output validator]
  Validate --> Persist[Neon attempt, cost and turn completion]
  Persist --> Admin[/reply-assistant]
  Admin --> Copy[staff copies draft]
  Copy --> MetaSuite[manual send in Meta Business Suite]
  MetaSuite --> HumanEcho

  Web[Website Chat] --> WebGuard[session + identity + rate limit]
  WebGuard --> Ingest
  Validate -->|website safe structured result| WebPublish[transactional website publication]
  WebPublish --> WebUpdates[/api/customer-chat/updates]
```

There is no code edge from `Validate` or `Persist` to a Meta Send API.

## 2. Exact Execution Path

### 2.1 Meta ingress and filtering

1. `src/app/api/meta/webhook/route.ts:1-3` selects the Node runtime and exports GET/POST.
2. `src/app/api/meta/webhook/route-handler.ts:7-22` parses configuration and wires the signed webhook to the shared customer-service runtime. `ingestConversationEvent` is the persistence entry; `turnRecoveryRunner.runOnce({ turnId })` is the immediate worker entry; Next.js `after()` is the scheduler.
3. `src/server/customer-service/meta/webhook-handler.ts:12-47` rejects a declared or streamed body above 256 KiB.
4. `src/server/customer-service/meta/webhook-handler.ts:94-123`:
   - GET verification is available only while `REPLY_ASSISTANT_ENABLED` is true and the verify token matches.
   - POST returns 503 while disabled.
   - POST verifies `x-hub-signature-256`, parses JSON, and rejects any `entry.id` that differs from `META_PAGE_ID`.
5. `src/server/customer-service/adapters/facebook.ts:68-120` accepts only `object === "page"`, then only `entry.messaging[].message` records with a non-empty `mid`, conversation identity and text or attachment.
   - Customer conversation key: sender PSID.
   - Staff echo conversation key: recipient PSID.
   - External message key: Meta `message.mid`.
   - `message.reply_to.mid` is retained for conservative human-reply matching.
   - `message.is_echo === true` becomes a `staff / human_outbound` event, but only when the echo sender equals the entry Page ID.
   - Read, delivery, reaction and other non-message events are ignored because they do not satisfy the message/mid requirements.
   - A distinct `object === "instagram"` payload is rejected by normalization.
6. `src/server/customer-service/meta/webhook-handler.ts:72-74,125-176` HMAC-hashes the conversation, message, reply-to and attachment identifiers before repository ingress. Raw PSIDs and mids are not passed into the repository.

### 2.2 Durable event/turn creation

1. `src/server/customer-service/repositories/drizzle-customer-service-repository.ts:2079-2547` runs ingress in one PostgreSQL transaction.
2. It inserts or resolves the channel conversation, verifies/persists the channel-compatible identity, and inserts the event/message using DB unique constraints.
3. Staff echoes are stored as `human_outbound`, grouped for learning, and suppress an eligible open/sealed customer turn (`:2194-2341`).
4. Customer fragments can merge into one open turn within the bounded debounce window, at most eight fragments and 2,400 characters (`:2344-2500`).
5. Customer text creates/updates `customer_service_messages`, `customer_service_turns`, and `customer_service_conversation_events`. A duplicate external message key returns `duplicate` rather than creating another turn.
6. Attachment metadata is stored in `customer_service_attachments`; the associated `customer_service_image_jobs` row is immediately terminal `human_review_required` with a null source ciphertext (`:2501-2529`).

### 2.3 Immediate and recovery execution

1. For a new attachment-free customer turn, `src/server/customer-service/meta/webhook-handler.ts:177-186` schedules an `after()` callback, waits until the debounce deadline, then calls `turnRecoveryRunner.runOnce({ turnId })`.
2. `src/app/api/internal/reply-assistant/turn-recovery/route.ts:8-27` is the durable fallback entry. It is protected by `CRON_SECRET`; `route-handler.ts:4-33` uses constant-time digest comparison, processes at most ten turns, then runs human-reply and learning maintenance.
3. `vercel.json:36-38` invokes that route every 30 minutes.
4. `sealDueCustomerTurn` (`drizzle-customer-service-repository.ts:2549-2645`) first suppresses acknowledgement-only turns and then requires an active, not-exhausted channel pilot. Without it, the turn becomes `pilot_complete` and no model runs.
5. `claimDueCustomerTurn` (`:2648-2830`) uses PostgreSQL row locks and `SKIP LOCKED`, recovers stale leases, handles interrupted attempts, and assigns a new lease token.
6. `createCustomerTurnRecoveryRunner().runOnce` (`src/server/customer-service/turn-recovery-runner.ts:143-203`) calls `engine.generateDraft`. Facebook provider failures retry with exponential delays of 1, 2 and then at most 15 minutes, capped at three processing attempts. Website errors instead open a human review.

### 2.4 Context, gate and prompt

1. `CustomerServiceEngine.generateDraft` (`src/server/customer-service/engine.ts:256-670`) calls `loadDraftInput(messageId, 6)`.
2. `loadDraftInput` (`drizzle-customer-service-repository.ts:3713-3882`) reconstructs recent same-conversation customer/staff events from Neon. The engine supplies only six context items to the prompt; this is not full conversation history.
3. `resolveConversationState` derives intent, market, product, size, people/pets and missing fields from the current text, recent context, and Website page context where present.
4. `evaluatePolicyGate` (`src/server/customer-service/policy-gate.ts:143-231`) blocks high-risk, realtime/private-record, unresolved, missing-rule, non-confirmed and automation-disallowed cases before provider invocation.
5. If the message asks for a catalogue price, the engine reads the current product registry from Neon and permits only an exact server-resolved price (`engine.ts:306-340`). A failed price read creates a blocked attempt rather than guessing.
6. Any attachment context causes `image_review_required` before the text provider (`engine.ts:370-384`).
7. `retrieveKnowledge` (`src/server/customer-service/knowledge-retrieval.ts:48-92`) selects only confirmed, non-high-risk, automation-permitted rules, at most two approved examples and two golden examples.
8. Approved case-memory lookup is attempted from Neon (`engine.ts:421-437`), limited to three; failure is fail-open to no case memories.
9. The repository atomically reserves budget/attempt state and rechecks whether a human reply has won the race before the provider call (`engine.ts:395-467`).

### 2.5 OpenAI, validation and persistence

1. `OpenAIResponsesProvider.generate` (`src/server/customer-service/providers/openai-responses.ts:51-109`) directly POSTs to `https://api.openai.com/v1/responses`.
2. The request uses `store:false`, `reasoning.effort:"none"`, `max_output_tokens:220`, low verbosity, and a 20-second timeout.
3. The provider itself has no retry and no fallback model. A transport/non-2xx/empty result becomes a generic provider error; Facebook turn recovery may later create a new attempt.
4. Facebook uses `buildDraftPrompt` (`src/server/customer-service/prompt-builder.ts:127-249`) and receives natural-language draft text only.
5. `validateDraft` (`src/server/customer-service/output-validator.ts:72-112`) rejects empty/AI-style output, commitments, unapproved monetary claims/percentages, intent-specific policy leakage, and output above five lines or 800 characters.
6. `completeProviderAttempt` persists the result, usage/cost and releases/settles budget; `completeCustomerTurnProcessing` closes the turn.

### 2.6 Human use and Meta outbound boundary

1. `/reply-assistant` loads the Neon-backed queue and metrics (`src/app/reply-assistant/page.tsx:20-92`).
2. The protected generate/regenerate routes invoke the same engine with `manual_generate` or `manual_regenerate` (`src/app/api/reply-assistant/messages/[messageId]/generate/route-handler.ts:11-38`; `drafts/[attemptId]/regenerate/route-handler.ts:10-42`).
3. The client permits accept/edit/reject/regenerate, copies approved text to the clipboard, and separately records `sent_confirmed` (`src/components/reply-assistant/reply-assistant-client.tsx:480-539`).
4. The feedback route only appends a Neon feedback event; it does not contact Meta (`src/app/api/reply-assistant/drafts/[attemptId]/feedback/route-handler.ts:17-48`).
5. The actual customer-facing Facebook send remains a human action outside this application.

## 3. File / Function Map

| Area | File and line range | Current responsibility |
|---|---|---|
| Public Meta route | `src/app/api/meta/webhook/route.ts:1-3` | Node route and method exports |
| Meta route wiring | `src/app/api/meta/webhook/route-handler.ts:7-22` | Config, DB ingress, `after()`, turn worker wiring |
| Webhook security | `src/server/customer-service/meta/webhook-handler.ts:12-123` | Size, signature, JSON and Page checks |
| Meta normalization | `src/server/customer-service/adapters/facebook.ts:26-120` | Page message parsing, echo role, attachments |
| Identity hashing | `src/server/customer-service/meta/webhook-handler.ts:72-74,132-169` | HMAC external identifiers |
| Inbox identity | `src/server/customer-service/identity/customer-identity.ts:42-70` | Facebook PSID hash and Website identity types |
| Durable ingress | `src/server/customer-service/repositories/drizzle-customer-service-repository.ts:2079-2547` | Transactional event/message/turn/dedupe |
| Turn sealing | same file `:2549-2645` | Acknowledgement and active-pilot gates |
| Atomic claim | same file `:2648-2830` | Lease, stale recovery, interrupted attempt rules |
| Draft input | same file `:3713-3917` | Recent context and attachment context reads |
| Attempt reservation | same file `:4514-4676` | Attempts, budget, human-race check |
| Case memory | same file `:4949-5032` | Approved memory retrieval/audit |
| Attempt completion | same file `:5349-5413` | Draft/error/cost settlement |
| Shared runtime | `src/server/customer-service/runtime.ts:15-68` | Repository, model, engine and worker composition |
| AI engine | `src/server/customer-service/engine.ts:150-670` | State, gate, knowledge, pricing, model and validation |
| Prompt builder | `src/server/customer-service/prompt-builder.ts:18-249` | Compact state, six-item context, instructions/examples |
| Policy gate | `src/server/customer-service/policy-gate.ts:30-231` | High-risk/realtime/confirmed-rule decisions |
| Output validator | `src/server/customer-service/output-validator.ts:72-112` | Final content and claim boundary |
| Text provider | `src/server/customer-service/providers/openai-responses.ts:27-109` | Direct Responses API client |
| Recovery runner | `src/server/customer-service/turn-recovery-runner.ts:69-205` | Claim/generate/retry/website publication |
| Recovery route | `src/app/api/internal/reply-assistant/turn-recovery/*` | Authenticated cron worker |
| Admin UI | `src/app/reply-assistant/page.tsx`; `src/components/reply-assistant/reply-assistant-client.tsx` | Queue, review and manual copy workflow |
| Website intake | `src/app/api/customer-chat/messages/route-handler.ts:73-216` | Session-bound ingress, rate limit and `after()` |
| Website publication | `src/server/customer-service/website/publication.ts:1-25`; repository `:3419-3591` | Website-only validated AI publication |
| Website updates | `src/app/api/customer-chat/updates/route-handler.ts:37-90` | Session/identity-bound public response reads |
| Image job runner | `src/server/customer-service/image-job-runner.ts:48-130` | Current human-review-only image settlement |
| Latent image provider | `src/server/customer-service/providers/openai-image-analysis.ts:81-204` | Unwired Responses image analysis client |
| Current schema | `src/server/db/schema/customer-service.ts:24-1118` | Customer-service, learning, Website and image tables |

## 4. Current OpenAI Model + Prompt Summary

### Provider and model

- API: OpenAI Responses API over direct server-side `fetch`; no OpenAI SDK dependency.
- Model selection: `OPENAI_MODEL`, source default `gpt-5.6-luna` (`config.ts:176`; provider constructor `openai-responses.ts:34-48`).
- Actual Production model: **UNKNOWN from source-only audit** because an environment override may exist; no secret or Production env value was read.
- Provider selection: only exact `AI_PROVIDER=openai` selects OpenAI; missing/other values select the deterministic mock provider (`config.ts:98-103`). This is a configuration fallback, not a runtime fallback after OpenAI failure.
- Reasoning: `none`; maximum output 220 tokens; low verbosity; 20-second request timeout; `store:false`.

### Prompt inputs

- Current customer turn plus at most six recent same-conversation customer/staff context items.
- Server-resolved conversation state: intent, market, product candidates/key, size, people/pets, photo count, missing fields and price intent.
- Confirmed compiled rules, quality guide, at most two approved historical examples, at most two golden examples, and up to three approved case memories.
- Server-verified current catalogue facts only for eligible exact price enquiries.
- Facebook instruction: produce one information-dense English draft for human review, at most five lines/800 characters, no live/unconfirmed claims, and no claim that it was sent.
- Website instruction: return a strict JSON decision. The server renders the customer text and independently verifies a renderer proof before publication.

### Context limitations

- No Meta Graph conversation-history retrieval exists.
- No full-thread transcript is sent. The effective bound is six context items (`engine.ts:260`; `prompt-builder.ts:38,240`).
- There is no model-facing long-running conversation summary. Stored human-match summaries and learning artifacts are not a substitute for full active conversation context.
- Facebook messages are treated as data but do not use the Website prompt's per-request JSON boundary and strict structured decision contract.

### Current knowledge versus attached Business Brain

- Runtime knowledge: `src/server/customer-service/knowledge/compiled-knowledge.json`.
- Current knowledge version: `894aa90cd6e228d303bfb55fd15de5e7525014432e47786bf85e3921a6705b92`.
- Compiled metadata: build version 1, compiled 2026-08-20, source commit `15c5d55...`, 58 policy rules.
- Attached Business Brain v0.5.1: **not loaded by current runtime and not present as the compiled artifact**. It must not be described as deployed behavior until a later reviewed integration.

## 5. Neon Dependency Table

All rows below are dependencies observed in the current ordinary Facebook drafting path or its direct human-echo/dedupe control path.

| File / function | Operation | Tables | Purpose | Mandatory now? | Future classification |
|---|---|---|---|---|---|
| `runtime.ts:createCustomerServiceRuntime` | connect | all repository operations | Creates Drizzle repository before ingress/worker use | Yes | `REMOVE_FROM_AI_HOT_PATH` |
| `ingestConversationEvent` | read/write transaction | `customer_service_conversations`, `customer_service_conversation_identities` | Resolve hashed Facebook PSID conversation and assert channel identity | Yes | `REMOVE_FROM_AI_HOT_PATH` |
| `ingestConversationEvent` | write | `customer_service_messages`, `customer_service_conversation_events`, `customer_service_turns` | Durable dedupe, source text, turn/debounce creation | Yes | `REMOVE_FROM_AI_HOT_PATH` |
| `ingestConversationEvent` attachment branch | write | `customer_service_attachments`, `customer_service_image_jobs` | Hashed metadata and terminal human-review image record | Only for attachments | `REMOVE_FROM_AI_HOT_PATH` |
| `ingestConversationEvent` staff branch | read/write | `customer_service_conversation_events`, `customer_service_human_reply_matches`, `customer_service_human_reply_match_events`, `customer_service_turns` | Detect/store Meta echoes, group human reply, suppress AI race | Yes for staff echoes | `REMOVE_FROM_AI_HOT_PATH` |
| `sealDueCustomerTurn` | read/write | `customer_service_turns`, `customer_service_conversation_events`, `customer_service_pilot_runs`, `customer_service_messages` | Acknowledgement suppression and bounded-pilot allocation | Yes | `REMOVE_FROM_AI_HOT_PATH` |
| `claimDueCustomerTurn` | read/write | `customer_service_turns`, `customer_service_attachments`, `customer_service_ai_attempts`, budget tables | Atomic claim, stale lease recovery and interrupted-attempt resolution | Yes | `REMOVE_FROM_AI_HOT_PATH` |
| `loadDraftInput` | read | `customer_service_messages`, `customer_service_turns`, `customer_service_conversation_events`, Website message table where applicable | Reconstruct current message and recent six-item context | Yes | `REMOVE_FROM_AI_HOT_PATH` |
| `selectImageContext` | read | `customer_service_attachments`, messages/image analysis records | Ensure attachment-bearing messages cannot enter text-only drafting | Yes (check always runs) | `REMOVE_FROM_AI_HOT_PATH` |
| `createGateBlockedAttempt` | write | `customer_service_ai_attempts`, `customer_service_messages` | Audit a blocked/realtime/image decision | Yes when blocked | `REMOVE_FROM_AI_HOT_PATH` |
| `getProductRegistryRuntime().current` | read | `product_registry_current` | Current first-party catalogue price and revision | Only price enquiries | `KEEP_ONLY_FOR_LIVE_BUSINESS_TOOL` |
| `reserveProviderAttempt` | read/write transaction | `customer_service_ai_attempts`, `customer_service_budget_state`, Website budget table where applicable, messages/turn events | Reserve cost, create attempt and recheck human race | Yes | `REMOVE_FROM_AI_HOT_PATH` |
| `retrieveApprovedCaseMemories` | read/write | `customer_service_case_memories`, `customer_service_case_retrievals` | Optional approved historical response signal plus retrieval audit | No; errors fall back to none | `REMOVE_FROM_AI_HOT_PATH` |
| `confirmProviderInvocation` | read/write transaction | `customer_service_ai_attempts`, `customer_service_messages`, turns/events and budget state | Last human-race check; mark provider call started | Yes | `REMOVE_FROM_AI_HOT_PATH` |
| `completeProviderAttempt` | read/write transaction | `customer_service_ai_attempts`, `customer_service_messages`, budget state | Persist outcome/usage/cost and settle reservation | Yes | `REMOVE_FROM_AI_HOT_PATH` |
| `completeCustomerTurnProcessing` | write | `customer_service_turns` | Close leased work item | Yes | `REMOVE_FROM_AI_HOT_PATH` |
| `appendFeedback`, queue/metrics/learning methods | read/write | feedback, attempts, messages, human-match, learning and UI revision tables | Admin review, metrics and learning | Not for model call itself | `KEEP_FOR_NON_AI_PRODUCT_FEATURE` |
| Website session/publication methods | read/write | web sessions, website assistant messages, human reviews, selectors and alert outbox | Website Chat identity, publication and staff review | Not in Facebook path | `KEEP_FOR_NON_AI_PRODUCT_FEATURE` |

### Dependency conclusion

- **Can current ordinary Facebook drafting work while Neon is asleep/unavailable? No.** The first durable ingress transaction and every scheduling/context/attempt step depend on the database.
- The one appropriate future synchronous DB dependency is a narrowly invoked live business tool, such as canonical current pricing. Even that should run only when the question requires a live fact.
- Cost/audit/learning persistence can remain as asynchronous or non-hot-path product behavior, but must not decide whether a normal customer reply can be generated.

## 6. Image Handling Findings

### Current live path

- The Facebook adapter extracts only HTTPS image references, up to five valid image sources; invalid/overflow/non-image attachments become safe unsupported metadata (`adapters/facebook.ts:15-65`).
- The signature-verified handler intentionally strips the raw URL before persistence. It retains only HMAC attachment identity, ordinal, type hint and failure code (`meta/webhook-handler.ts:132-173`).
- Every attachment creates a terminal `human_review_required` job with `sourceCiphertext:null` and `sourceExpiresAt:null`. The turn is marked processing-complete and no `after()` image work is scheduled.
- `kickImageJob` is wired in the route but never invoked by the current handler.
- `CustomerServiceEngine.generateDraft` blocks any detected attachment before the text model.
- **Actual customer image bytes/URLs reaching the current model: NO.**

### Present but not wired into runtime

The repository contains a privacy/safety-oriented latent pipeline:

- `attachment-source-protector.ts`: AES-256-GCM-protected temporary source references.
- `facebook-source-reader.ts`: HTTPS allowlist, DNS pinning, redirect revalidation, private-address blocking, bounded download and MIME/dimension checks.
- `attachment-processor.ts`: private-store write/read checksum, budget reservation, structured vision analysis and deletion.
- `openai-image-analysis.ts`: Responses API `input_image` data URLs, strict JSON schema, `store:false`, 20-second timeout.

However, `runtime.ts:37-43` instantiates only the human-review image job runner and private cleanup store. It does not instantiate the source protector, source reader, attachment processor or OpenAI image provider. Source-level tests explicitly guard this boundary.

### Limits in the latent pipeline

`attachments/limits.ts:1-16` defines: maximum 5 images, 4 MiB each, 12 MiB batch, 20 million pixels, 8,192 px maximum side, two redirects, 10-second per-image timeout, 20-second batch timeout, 24-hour stored-byte retention and 15-minute source-reference retention.

### Image conclusion

- Phase 3.4 safety remains intact: raw source locations are not persisted or exposed, and image messages are human-review only.
- Current image processing cannot work without Neon and, more importantly, is not wired to analyze images at all.
- A future Sol image path must preserve the existing validation/SSRF/size/privacy rules even if Neon is removed from the response hot path.

## 7. Current Control / Feature Flag Findings

| Control | Current behavior | Finding |
|---|---|---|
| `REPLY_ASSISTANT_ENABLED` | Exact case-insensitive `true` enables Facebook webhook/worker channel | Fail-closed boolean, but OFF returns webhook 503 and stops message ingestion as well as AI |
| `WEBSITE_CUSTOMER_ASSISTANT_ENABLED` | Separately enables Website Chat | Channel isolation exists |
| `AI_PROVIDER` | Exact `openai` selects OpenAI; otherwise mock | No automatic model fallback |
| `OPENAI_MODEL` | Overrides source default `gpt-5.6-luna` | Exact Production value not read |
| `REPLY_ASSISTANT_IMAGE_ANALYSIS_ENABLED` | Enables creation of current human-only image runner requirements | Does not activate actual vision analysis in runtime |
| `REPLY_ASSISTANT_PILOT_LIMIT` | Default config value 100 | Actual generation also requires active DB pilot |
| `customer_service_pilot_runs` | `disabled / active / stopped / completed`; one active run per channel | CLI-only bounded pilot, not an operator schedule |
| `CRON_SECRET` | Required when Facebook or Website channel is enabled | Protects recovery route |
| Debounce/group envs | 250–10,000 ms debounce; 10–120 sec human grouping | Operational timing only |
| Admin UI | Displays `Pilot enabled` when either channel env is on | No control to change mode |
| Per-conversation pause | None | Human echoes cancel/suppress races reactively, but no explicit takeover state |
| Schedule | None | No day/time periods, override, current state or next transition |
| Backlog catch-up | Normal due-turn recovery only | No OFF→ON latest-unanswered conversation reconciliation |
| UI polling | Reply Assistant updates only on explicit Refresh/action | No timer/focus/visibility polling in current dashboard |
| Browser automation mode | Can suppress client polling in test automation | Not a business AI ON/OFF mode |

No existing control satisfies the requested `ON / OFF / SCHEDULE` semantics.

## 8. Meta Send / Dedupe Findings

### Send capability

- No Meta Page access-token configuration exists in the Reply Assistant runtime.
- No Graph `/messages` client, Messenger Send API wrapper, send route or outbound recipient payload exists in scoped production source.
- `META_CAPI_ACCESS_TOKEN` and Graph `/events` code elsewhere in the repository belong to advertising conversion analytics, not customer messaging.
- Facebook AI generation therefore only suggests a draft. The admin UI uses the clipboard; a human sends outside the application.

### Inbound dedupe and race safety

- Conversations are unique by `(channel, external_key_hash)` (`customer-service.ts:70-73`).
- Messages and conversation events are unique by `(channel, external_message_key_hash)` (`:161-166`, `:279-281`). A webhook retry with the same `mid` cannot create a second message/turn.
- A valid Meta echo is stored as staff context, grouped conservatively, and can suppress an open/sealed customer turn.
- Before OpenAI invocation and again during completion/publication, transaction locks check whether human output has already won. Stale provider-start uncertainty is not blindly replayed.
- Because the application has no Meta outbound send, there is currently no outbound delivery idempotency key, delivery receipt state, or automatic-send dedupe to evaluate.

### Gap against future target

Future Meta auto-send will need a separate, explicit, idempotent sender boundary. It must combine stable business event identity, human-takeover state, latest-unanswered validation, Meta echo reconciliation and delivery outcome handling. Existing inbound `mid` uniqueness is necessary but not sufficient for outbound exactly-once behavior.

## 9. Website Chat Shared-Code Findings

### Shared components

- `createCustomerServiceRuntime`, Drizzle repository, `CustomerServiceEngine`, conversation state, compiled knowledge, policy gate, provider, budget logic, case memories and turn recovery are shared.
- Both channels use transactional `ingestConversationEvent`, debounce, durable turns and the same six-item context limit.

### Website-specific protections and behavior

- `POST /api/customer-chat/messages` requires a trusted origin, bounded 4 KiB JSON, a signed/issued chat session, authoritative identity agreement, session/network rate limits, and safe server-resolved product/page context (`messages/route-handler.ts:73-216`).
- Website ingress supplies `attachments:[]`; Website Chat currently has no image input.
- Website customer text is sanitized before model input and enclosed in a per-request JSON boundary. The model returns a strict structured decision, not free-form public prose.
- The server renders the final reply and stores a renderer proof. `publishWebsiteValidatedAi` then re-locks the turn, requires an active website session, rejects a newer turn or human reply, validates the attempt/proof, inserts one website assistant message with conflict protection, and closes the turn transactionally (`drizzle...ts:3419-3591`).
- Unsafe/realtime/provider-error/system-failure Website outcomes create a human-review incident rather than a public AI response.
- Staff can explicitly answer a Website review inside the admin application; this is a Website-only committed human message and cannot address Facebook (`answerWebsiteReview`, `drizzle...ts:1718-1900`).
- Public update reads require the same active session and authoritative identity (`customer-chat/updates/route-handler.ts:37-90`).

### Shared-code risk

A direct replacement of `CustomerServiceEngine` or its repository contract could unintentionally alter Website Chat's structured output, identity isolation, publication proof, human-review fallback, budget and public update semantics. Phase 2 should extract a channel-neutral reasoning core while retaining distinct Facebook and Website orchestration/publication adapters.

## 10. Risks / Unknowns

| Severity | Finding |
|---|---|
| Major | Neon is mandatory across current Meta ingress and drafting. The future ordinary-message no-Neon requirement is not met. |
| Major | Current OFF semantics return 503 at the Meta webhook, so Meta messages do not continue to be ingested while only AI is off. |
| Major | No Meta outbound send capability exists. This is safe today but is a deliberate future implementation gap, not an almost-ready auto-send path. |
| Major | Customer images do not reach the model; current image jobs are terminal human review. |
| Major | No ON/OFF/SCHEDULE admin control, smart backlog reconciliation or explicit per-conversation human-takeover state exists. |
| Major | Attached Business Brain v0.5.1 is not the runtime knowledge artifact. Treating it as deployed would risk incorrect prices/shipping/policy. |
| Medium | Only six recent events are provided; long, fragmented or resumed conversations may lose relevant context. |
| Medium | The current provider uses `reasoning:none`; this is not the requested strong reasoning configuration. |
| Medium | Current adapter explicitly accepts only `object=page`; Instagram Direct behavior is unsupported/unverified. |
| Medium | When `after()` fails, the recurring recovery cadence is every 30 minutes, so draft availability can be delayed materially. |
| Medium | Active pilot state is a second DB prerequisite independent of the environment flag; source alone cannot prove the current Production pilot status. |
| Unknown | Exact Production values for `REPLY_ASSISTANT_ENABLED`, `AI_PROVIDER`, `OPENAI_MODEL`, image flag and active pilot row were intentionally not read. Source behavior is confirmed; current deployed configuration values are not asserted. |
| Unknown | Real Meta subscription object/event set and Page/Instagram permissions were not queried or changed. |
| Unknown | No live Meta event, Production database row or OpenAI call was generated by this audit. End-to-end Production delivery was outside scope. |

## 11. Recommended Cut Points for the New Sol Engine

These are code boundaries for Phase 2, not implementation performed in this audit.

1. **Keep the ingress security shell.** Preserve the 256 KiB body guard, signature verification, Page ownership validation and minimal normalized adapter boundary.
2. **Insert AI Control before customer-service runtime construction.** The effective ON/OFF/SCHEDULE decision must occur before `createCustomerServiceRuntime()` or any reply-specific repository call. OFF must cause zero OpenAI, context, draft or Reply-Assistant Neon work while returning a normal Meta webhook acknowledgement.
3. **Split event acceptance from AI orchestration.** Signature-valid Meta events should be acknowledged independently of the existing Neon turn pipeline. Do not make the future ordinary reply depend on `ingestConversationEvent`, pilot rows or turn leases.
4. **Introduce a context-provider interface.** A Meta context adapter should obtain/maintain the active conversation needed by Sol without querying historical R&R Neon reply tables. The Website adapter should continue using its session-isolated repository and publication contracts.
5. **Make Business Brain a reviewed local/versioned input.** Compile v0.5.1 (or its approved successor) into a deterministic runtime artifact. Keep current first-party price/shipping/order data behind explicit live tools rather than historical case memory.
6. **Create a Sol provider boundary.** Replace the default low-reasoning request for the new path without changing the existing Website structured-publication contract by accident.
7. **Preserve pre- and post-model safety.** Retain risk classification, confirmed-fact selection and output checks. Map future GREEN/YELLOW/RED decisions explicitly; RED must never reach an autonomous sender.
8. **Reuse image safety components, not the current terminal wiring.** The future attachment adapter may pass validated bounded bytes to Sol, but must keep URL redaction, SSRF/DNS pinning, MIME/dimension limits, `store:false`, retention and no-image-generation safeguards.
9. **Add a distinct Meta outbound adapter.** It should be the only holder of Page send credentials and require a stable idempotency key, an allowed risk result, current AI-control state, latest-unanswered check and no-human-takeover condition.
10. **Add explicit human-takeover state outside the model.** A staff echo or manual pause should immediately block generation/send for that conversation until explicitly released.
11. **Implement smart OFF→ON reconciliation at conversation level.** Inspect only the latest unanswered customer turn, merge consecutive customer messages, and exclude any conversation with later staff output or prior processed identity. Never replay all stored events.
12. **Move audit/learning persistence after the customer-facing decision.** Operational metrics may be best-effort asynchronous; they must not make a normal Sol response depend on Neon availability.
13. **Keep Website publication separate.** Website Chat should continue to use signed sessions, rate limits, structured decisions, server rendering, proof verification and transactional publication even if it shares Sol reasoning utilities.

## 12. Files Likely to Be Modified in Phase 2

### Existing files likely requiring focused edits

- `src/app/api/meta/webhook/route-handler.ts`
- `src/server/customer-service/meta/webhook-handler.ts`
- `src/server/customer-service/adapters/facebook.ts`
- `src/server/customer-service/runtime.ts`
- `src/server/customer-service/engine.ts`
- `src/server/customer-service/prompt-builder.ts`
- `src/server/customer-service/policy-gate.ts`
- `src/server/customer-service/output-validator.ts`
- `src/server/customer-service/providers/ai-provider.ts`
- `src/server/customer-service/providers/openai-responses.ts`
- `src/server/customer-service/attachments/facebook-source-reader.ts`
- `src/server/customer-service/attachments/image-validation.ts`
- `src/server/customer-service/knowledge/compiled-knowledge.json` and its source/compiler workflow
- `src/app/reply-assistant/page.tsx`
- `src/app/reply-assistant/live-dashboard.tsx`
- `src/components/reply-assistant/reply-assistant-client.tsx`
- `vercel.json` only if an approved schedule/recovery trigger is later required

### New focused modules likely required

Names remain proposals and should follow the approved Phase 2 design:

- AI control evaluator and Auckland schedule adapter
- channel-neutral Sol reasoning service
- Meta conversation-context adapter
- canonical Business Brain loader/version gate
- live business-tool interfaces (pricing/shipping/order lookups only when needed)
- Meta Messenger outbound provider with idempotent delivery state
- conversation takeover/latest-unanswered evaluator
- smart backlog reconciler

### Files that should remain isolated unless a reviewed interface change requires them

- `src/app/api/customer-chat/**`
- `src/server/customer-service/website/**`
- Website session, identity, rate-limit, renderer-proof and public-update code
- commerce/payment/order code
- database migrations and schema during the design/audit stages

## 13. Verification and No-Change Statement

### Verification performed

- Fetched/pruned `origin` and audited a clean isolated worktree at current `origin/main` (`081fc825...`).
- Traced every requested path through actual source: Meta route, signature/size/Page validation, adapter, identity, transactional ingress, turn/pilot/lease recovery, context, image branch, policy, knowledge, price tool, OpenAI provider, output validation, persistence, admin review, Website publication, and send/dedupe boundary.
- Inspected current customer-service schema and repository methods rather than relying on old design documents.
- Inspected recent mainline Reply Assistant/Website changes through 2026-09-02, including context precedence, AU/NZ market preservation, canonical price resolution, channel parity, identity reconciliation and Website read isolation.
- Safe focused test run: **190 passed, 1 did not execute its assertion** across 10 files. The one failure was module resolution for missing local `@vercel/blob` in this newly isolated worktree, not a behavior assertion failure. No dependency installation was performed to preserve the narrow audit boundary.
- The passing set included Meta adapter/webhook, engine, turn recovery, no-auto-send, config, Website publication, Website intake and Website update behavior.

### Explicit no-change statement

**No Production changes were made. No deployment was run. No database migration was created, edited or executed. No Neon schema or data was changed. No environment variable was read or modified. No Meta subscription, permission, token, campaign or outbound message was changed. No OpenAI or Meta API call was made. No prices, shipping rules, payment, order, authentication or Website Chat behavior was changed. Auto-send remains absent.**
