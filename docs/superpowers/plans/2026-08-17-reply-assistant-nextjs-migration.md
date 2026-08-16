# Reply Assistant Next.js Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy a PostgreSQL-backed, policy-gated, human-review-only Reply Assistant inside the existing Next.js admin application without enabling Messenger sending.

**Architecture:** A signed Meta webhook persists normalized messages before acknowledgement and schedules idempotent draft generation with Next.js `after()`. A channel-independent Customer Service Engine applies intent detection, policy gate, compiled knowledge retrieval, OpenAI generation and output validation, while authenticated admin/staff APIs and UI record human feedback and pilot metrics in PostgreSQL.

**Tech Stack:** Next.js 16.3 Route Handlers and `after()`, React 19, TypeScript 5, Better Auth 1.6, Drizzle ORM 0.45, PostgreSQL, OpenAI Responses API, Zod 4, Vitest 4 and Testing Library.

## Global Constraints

- Begin implementation in a new clean worktree from the then-current `origin/main`; do not use a dirty or behind local `main`.
- Keep the Customer Service Engine channel-independent.
- Implement Facebook as the only active channel and expose only a disabled Website adapter interface.
- Do not add `META_PAGE_ACCESS_TOKEN`, Graph API send code, a send route or automatic customer sending.
- Protect `/reply-assistant` and every related admin API with Better Auth permission `use_reply_assistant`, granted to `admin` and `staff`.
- Verify Meta signature and Page ID before persistence; filter echoes and supported events; use database uniqueness for duplicates.
- Persist every accepted message before scheduling AI work.
- Block HIGH RISK, `UNRESOLVED` and `REALTIME_REQUIRED` before provider invocation.
- Preserve the current output-validator standard.
- Use PostgreSQL for messages, attempts, feedback, usage, cost, budgets and pilot metrics; never use runtime JSONL or persistent filesystem writes.
- Keep secrets server-only; no secret may use a `NEXT_PUBLIC_` prefix.
- Initial Production deployment uses `REPLY_ASSISTANT_ENABLED=false`.
- Meta callback cutover is the final rollout step and requires separate approval.
- Keep the previous ngrok callback operational for 48 hours after cutover.
- Follow TDD: RED test, minimal GREEN implementation, focused regression, then commit.

---

### Task 1: Preserve and compile the knowledge source

**Files:**
- Create: `customer-service-knowledge/README.md`
- Create: `customer-service-knowledge/business-rules.md`
- Create: `customer-service-knowledge/design-rules.md`
- Create: `customer-service-knowledge/escalation-rules.md`
- Create: `customer-service-knowledge/faq.md`
- Create: `customer-service-knowledge/knowledge-gaps.md`
- Create: `customer-service-knowledge/phase-3-1-output-remediation.md`
- Create: `customer-service-knowledge/policy-source-map.md`
- Create: `customer-service-knowledge/pricing-rules.md`
- Create: `customer-service-knowledge/reply-examples.jsonl`
- Create: `customer-service-knowledge/revision-refund-rules.md`
- Create: `customer-service-knowledge/runtime-audit.md`
- Create: `customer-service-knowledge/shipping-rules.md`
- Create: `customer-service-knowledge/tone-guide.md`
- Create: `scripts/compile-customer-service-knowledge.ts`
- Create: `scripts/compile-customer-service-knowledge.test.ts`
- Create: `src/server/customer-service/knowledge/compiled-knowledge.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: the audited source directory `/Users/ronnieli/Documents/Codex/2026-05-31/new-chat/customer-service-knowledge`.
- Produces: `compileCustomerServiceKnowledge(sourceDir): CompiledCustomerServiceKnowledge`, deterministic JSON and scripts `knowledge:build` / `knowledge:check`.

- [ ] **Step 1: Copy the audited knowledge files without rewriting them**

Copy the exact files listed above from the audited standalone directory. Review the staged diff to confirm no prices, policies, statuses, source dates or examples changed during migration.

- [ ] **Step 2: Write failing compiler tests**

Add tests that create small temporary knowledge fixtures and assert:

```ts
expect(result.rules.find((rule) => rule.id === "DESIGN-04")).toMatchObject({
  evidenceStatus: "CONFIRMED",
  highRisk: false,
  realtimeRequired: true,
  mayAnswerAutomatically: true,
});
expect(result.knowledgeVersion).toMatch(/^[a-f0-9]{64}$/);
expect(() => compile(fixtureWithDuplicateRuleIds)).toThrow("Duplicate policy rule");
expect(() => compile(fixtureWithUnknownStatus)).toThrow("Unknown policy status");
expect(() => compile(fixtureWithBrokenJsonl)).toThrow("Invalid reply example JSONL");
```

Also assert `UNRESOLVED` values do not appear in `answerableFacts`, `EVIDENCE-BASED` facts have `formalPolicy: false`, and two runs produce byte-identical JSON.

- [ ] **Step 3: Run the compiler test and verify RED**

Run:

```bash
npm test -- --run scripts/compile-customer-service-knowledge.test.ts
```

Expected: FAIL because the compiler and generated artifact do not exist.

- [ ] **Step 4: Implement the minimal compiler**

Parse the known Markdown table fields and JSONL examples with strict validation. Emit this stable shape:

```ts
type PolicyEvidenceStatus = "CONFIRMED" | "EVIDENCE-BASED" | "UNRESOLVED";

type CompiledCustomerServiceKnowledge = Readonly<{
  knowledgeVersion: string;
  rules: readonly Readonly<{
    id: string;
    evidenceStatus: PolicyEvidenceStatus;
    highRisk: boolean;
    realtimeRequired: boolean;
    source: string;
    lastConfirmed: string;
    mayAnswerAutomatically: boolean;
    requiresHumanEscalation: boolean;
    text: string;
  }>[];
  answerableFacts: readonly string[];
  toneGuide: string;
  replyExamples: readonly Readonly<{ intent: string; customer: string; reply: string }>[];
}>;
```

Use sorted keys and arrays before hashing and writing. Add:

```json
{
  "knowledge:build": "tsx scripts/compile-customer-service-knowledge.ts --write",
  "knowledge:check": "tsx scripts/compile-customer-service-knowledge.ts --check"
}
```

- [ ] **Step 5: Build and verify the artifact**

Run:

```bash
npm run knowledge:build
npm run knowledge:check
npm test -- --run scripts/compile-customer-service-knowledge.test.ts
```

Expected: all commands exit 0 and a second build has no Git diff.

- [ ] **Step 6: Commit**

```bash
git add customer-service-knowledge scripts/compile-customer-service-knowledge.ts scripts/compile-customer-service-knowledge.test.ts src/server/customer-service/knowledge/compiled-knowledge.json package.json package-lock.json
git commit -m "feat: compile reply assistant knowledge"
```

### Task 2: Add the admin/staff permission boundary

**Files:**
- Modify: `src/server/auth/admin-permissions.ts`
- Modify: `src/server/auth/admin-permissions.test.ts`
- Create: `src/app/reply-assistant/layout.tsx`
- Create: `src/app/reply-assistant/layout.test.tsx`

**Interfaces:**
- Consumes: existing `requireAdminPage` and `AdminShell`.
- Produces: `AdminPermission = ... | "use_reply_assistant"` and an authenticated `/reply-assistant` layout.

- [ ] **Step 1: Write failing permission tests**

```ts
expect(hasAdminPermission("admin", "use_reply_assistant")).toBe(true);
expect(hasAdminPermission("staff", "use_reply_assistant")).toBe(true);
expect(hasAdminPermission("customer", "use_reply_assistant")).toBe(false);
```

Add a layout test with injected/mocked `requireAdminPage` and assert it is called with:

```ts
expect(requireAdminPage).toHaveBeenCalledWith(
  "/reply-assistant",
  "use_reply_assistant",
);
```

- [ ] **Step 2: Run tests and verify RED**

```bash
npm test -- --run src/server/auth/admin-permissions.test.ts src/app/reply-assistant/layout.test.tsx
```

Expected: FAIL because the permission and layout do not exist.

- [ ] **Step 3: Add the minimal permission and layout**

Append `use_reply_assistant` to `AdminPermission` and `staffPermissions`. Create a no-index layout using the existing shell:

```tsx
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ReplyAssistantLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const access = await requireAdminPage("/reply-assistant", "use_reply_assistant");
  return <AdminShell administrator={{
    name: access.user.name ?? access.user.email ?? "Administrator",
    email: access.user.email ?? "Administrator",
    role: access.adminRole,
  }}>{children}</AdminShell>;
}
```

- [ ] **Step 4: Run focused auth tests**

```bash
npm test -- --run src/server/auth/admin-permissions.test.ts src/server/auth/require-admin.test.ts src/server/auth/require-admin-page.test.ts src/app/reply-assistant/layout.test.tsx
```

Expected: all tests pass; existing permissions remain unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/server/auth/admin-permissions.ts src/server/auth/admin-permissions.test.ts src/app/reply-assistant/layout.tsx src/app/reply-assistant/layout.test.tsx
git commit -m "feat: authorize reply assistant staff"
```

### Task 3: Define channel-independent types and adapters

**Files:**
- Create: `src/server/customer-service/types.ts`
- Create: `src/server/customer-service/adapters/facebook.ts`
- Create: `src/server/customer-service/adapters/facebook.test.ts`
- Create: `src/server/customer-service/adapters/website.ts`
- Create: `src/server/customer-service/adapters/website.test.ts`

**Interfaces:**
- Consumes: verified Meta messaging-event objects.
- Produces: `ChannelAdapter<TPayload>`, `NormalizedIncomingMessage`, `FacebookAdapterResult` and disabled Website adapter.

- [ ] **Step 1: Write failing adapter tests**

Cover one text message, multiple entries, echo, delivery receipt, missing text and website-disabled behaviour:

```ts
expect(adapter.normalize(validMessageEvent)).toEqual([{
  channel: "facebook",
  externalConversationKey: "sender-1",
  externalMessageKey: "mid-1",
  text: "How do I prepare my photos?",
  receivedAt: new Date("2026-08-17T00:00:00.000Z"),
}]);
expect(adapter.normalize(echoEvent)).toEqual([]);
expect(adapter.normalize(deliveryReceiptEvent)).toEqual([]);
expect(() => websiteAdapter.normalize({ text: "hello" })).toThrow(WebsiteChannelNotEnabledError);
```

- [ ] **Step 2: Run tests and verify RED**

```bash
npm test -- --run src/server/customer-service/adapters/facebook.test.ts src/server/customer-service/adapters/website.test.ts
```

Expected: FAIL because adapter modules do not exist.

- [ ] **Step 3: Implement types and minimal adapters**

Define the exact contracts from the approved design spec. Keep Meta payload types local to `facebook.ts`. The adapter returns only supported customer text messages and never calls a repository, provider or network client.

- [ ] **Step 4: Run adapter tests**

```bash
npm test -- --run src/server/customer-service/adapters/facebook.test.ts src/server/customer-service/adapters/website.test.ts
```

Expected: all tests pass, and the Website adapter remains unreachable from any route.

- [ ] **Step 5: Commit**

```bash
git add src/server/customer-service/types.ts src/server/customer-service/adapters
git commit -m "feat: add customer service channel adapters"
```

### Task 4: Port and characterize the policy-gated drafting core

**Files:**
- Create: `src/server/customer-service/intent-detection.ts`
- Create: `src/server/customer-service/intent-detection.test.ts`
- Create: `src/server/customer-service/policy-gate.ts`
- Create: `src/server/customer-service/policy-gate.test.ts`
- Create: `src/server/customer-service/knowledge-retrieval.ts`
- Create: `src/server/customer-service/knowledge-retrieval.test.ts`
- Create: `src/server/customer-service/output-validator.ts`
- Create: `src/server/customer-service/output-validator.test.ts`
- Create: `src/server/customer-service/fixtures/evaluation-cases.jsonl`
- Create: `src/server/customer-service/policy-regression.test.ts`

**Interfaces:**
- Consumes: compiled knowledge and normalized bounded context.
- Produces: `detectIntent`, `evaluatePolicyGate`, `retrieveKnowledge` and `validateDraft` as pure functions.

- [ ] **Step 1: Copy the de-identified 100-case evaluation fixture**

Copy `/Users/ronnieli/Documents/Codex/2026-05-31/new-chat/work/reply-assistant/evaluation/evaluation-cases.jsonl`. Verify it contains exactly 100 valid JSON lines and no sender IDs, email addresses, phone numbers or access tokens.

- [ ] **Step 2: Write characterization and safety tests**

Port the existing intent, gate and validator expectations. Add explicit provider-independent assertions:

```ts
expect(evaluatePolicyGate(refundMessage, knowledge)).toMatchObject({
  decision: "NEEDS_HUMAN_REVIEW",
  providerAllowed: false,
});
expect(evaluatePolicyGate(currentShippingPriceMessage, knowledge)).toMatchObject({
  decision: "REALTIME_DATA_REQUIRED",
  providerAllowed: false,
});
expect(retrieveKnowledge(photoQualityMessage, knowledge).facts).toContainEqual(
  expect.objectContaining({ id: "DESIGN-04", evidenceStatus: "CONFIRMED" }),
);
expect(validateDraft("We guarantee your blurry photo will print perfectly.", { intent: "photo_quality" })).toMatchObject({ ok: false });
```

The 100-case test must compare every actual gate decision with `expectedGateDecision` and fail on any bypass.

- [ ] **Step 3: Run tests and verify RED**

```bash
npm test -- --run src/server/customer-service/intent-detection.test.ts src/server/customer-service/policy-gate.test.ts src/server/customer-service/knowledge-retrieval.test.ts src/server/customer-service/output-validator.test.ts src/server/customer-service/policy-regression.test.ts
```

Expected: FAIL because the pure TypeScript modules do not exist.

- [ ] **Step 4: Port minimal behaviour without weakening rules**

Translate the validated standalone functions into pure TypeScript. Exact intents must be checked before broad banner/canvas matches. The gate returns rule IDs and does not accept a provider dependency. Retrieval never turns `EVIDENCE-BASED` or `UNRESOLVED` content into formal facts. For a rule with `realtimeRequired=true`, retrieval may include only a separately confirmed static process that is explicitly allowed for drafting; requests for the live value or outcome stop at the gate. Preserve all existing validator checks and the seven remediated photo/product/design cases.

- [ ] **Step 5: Run focused and 100-case tests**

Run the command from Step 3.

Expected: all tests pass; the 100-case fixture has zero gate bypasses.

- [ ] **Step 6: Commit**

```bash
git add src/server/customer-service/intent-detection.ts src/server/customer-service/intent-detection.test.ts src/server/customer-service/policy-gate.ts src/server/customer-service/policy-gate.test.ts src/server/customer-service/knowledge-retrieval.ts src/server/customer-service/knowledge-retrieval.test.ts src/server/customer-service/output-validator.ts src/server/customer-service/output-validator.test.ts src/server/customer-service/fixtures/evaluation-cases.jsonl src/server/customer-service/policy-regression.test.ts
git commit -m "feat: port policy gated drafting rules"
```

### Task 5: Add the PostgreSQL schema and transactional repository

**Files:**
- Create: `src/server/db/schema/customer-service.ts`
- Create: `src/server/db/schema/customer-service-schema.test.ts`
- Modify: `src/server/db/schema/index.ts`
- Create: `src/server/customer-service/repositories/customer-service-repository.ts`
- Create: `src/server/customer-service/repositories/drizzle-customer-service-repository.ts`
- Create: `src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts`
- Create: `scripts/configure-reply-assistant-pilot.ts`
- Create: `scripts/configure-reply-assistant-pilot.test.ts`
- Modify: `package.json`
- Create: `drizzle/0022_reply_assistant.sql`
- Modify: `drizzle/meta/_journal.json`
- Create: `drizzle/meta/0022_snapshot.json`

**Interfaces:**
- Consumes: hashed normalized messages and internal UUIDs.
- Produces: the `CustomerServiceRepository` methods specified in the database design.

- [ ] **Step 1: Write failing schema tests**

Assert all six table names, required columns and privacy exclusions:

```ts
expect(getTableName(customerServiceMessages)).toBe("customer_service_messages");
expect(columns(customerServiceAiAttempts)).toEqual(expect.arrayContaining([
  "providerCalled", "knowledgeVersion", "estimatedCostMicrousd", "latencyMs",
]));
expect(allCustomerServiceColumnNames).not.toEqual(expect.arrayContaining([
  "psid", "senderId", "rawPayload", "accessToken", "secret",
]));
```

- [ ] **Step 2: Run the schema test and verify RED**

```bash
npm test -- --run src/server/db/schema/customer-service-schema.test.ts
```

Expected: FAIL because the schema is absent.

- [ ] **Step 3: Implement the schema exactly as designed**

Create the six tables, checks, indexes and relations from `2026-08-17-reply-assistant-database-migration-design.md`. Export them from the schema index.

- [ ] **Step 4: Generate and inspect the migration**

```bash
npm run db:generate -- --name=reply_assistant
npm run db:check
```

Expected: Drizzle creates `0022_reply_assistant.sql` and metadata; SQL is additive and contains no change to existing tables except no-op metadata references.

- [ ] **Step 5: Write failing repository integration tests**

Use a dedicated `TEST_DATABASE_URL`. Test concurrent duplicate ingestion, pilot slots 1 through 100, sequence 101 blocking, conversation isolation, immutable attempt numbering, append-only feedback and metric-safe regeneration.

```ts
const [left, right] = await Promise.all([
  repository.ingestFacebookMessage(message),
  repository.ingestFacebookMessage(message),
]);
expect([left.status, right.status].sort()).toEqual(["created", "duplicate"]);
expect(await countMessagesByExternalHash(message.externalMessageKeyHash)).toBe(1);
```

Add command tests proving pilot configuration requires explicit `--name`, `--channel`, `--limit` and `--status`, rejects a second active run for the same channel, and never prints `DATABASE_URL`.

- [ ] **Step 6: Run repository tests and verify RED**

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm test -- --run src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts scripts/configure-reply-assistant-pilot.test.ts
```

Expected: FAIL because the repository does not exist.

- [ ] **Step 7: Implement minimal transactions**

Use `INSERT ... ON CONFLICT DO NOTHING`, row locks for pilot and budget state, deterministic lock order, and internal message UUID context lookup. Do not expose table objects outside the repository.

Implement the server-only pilot command and add:

```json
{
  "reply-assistant:pilot": "tsx scripts/configure-reply-assistant-pilot.ts"
}
```

The command must refuse implicit defaults for channel, limit or status and must not expose a browser route.

- [ ] **Step 8: Apply to the disposable database and verify GREEN**

```bash
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm test -- --run src/server/db/schema/customer-service-schema.test.ts src/server/customer-service/repositories/drizzle-customer-service-repository.integration.test.ts scripts/configure-reply-assistant-pilot.test.ts
```

Expected: all tests pass, including concurrency cases.

- [ ] **Step 9: Commit**

```bash
git add src/server/db/schema/customer-service.ts src/server/db/schema/customer-service-schema.test.ts src/server/db/schema/index.ts src/server/customer-service/repositories scripts/configure-reply-assistant-pilot.ts scripts/configure-reply-assistant-pilot.test.ts package.json package-lock.json drizzle/0022_reply_assistant.sql drizzle/meta/_journal.json drizzle/meta/0022_snapshot.json
git commit -m "feat: persist reply assistant pilot data"
```

### Task 6: Port usage, budget and OpenAI provider logic

**Files:**
- Create: `src/server/customer-service/usage-cost.ts`
- Create: `src/server/customer-service/usage-cost.test.ts`
- Create: `src/server/customer-service/providers/ai-provider.ts`
- Create: `src/server/customer-service/providers/mock-provider.ts`
- Create: `src/server/customer-service/providers/openai-responses.ts`
- Create: `src/server/customer-service/providers/openai-responses.test.ts`
- Create: `src/server/customer-service/config.ts`
- Create: `src/server/customer-service/config.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: server environment and a prepared provider prompt.
- Produces: `AiProvider.generate`, safe `ProviderResult`, cost estimates and validated server-only configuration.

- [ ] **Step 1: Write failing configuration and provider tests**

```ts
expect(() => parseCustomerServiceConfig({ REPLY_ASSISTANT_ENABLED: "true" }))
  .toThrow("META_APP_SECRET is required");
expect(JSON.stringify(publicConfig)).not.toContain("OPENAI_API_KEY");
expect(fetchSpy).toHaveBeenCalledWith("https://api.openai.com/v1/responses", expect.objectContaining({
  method: "POST",
  body: expect.stringContaining('"store":false'),
}));
expect(result.usage).toEqual({ inputTokens: 100, cachedInputTokens: 20, outputTokens: 30 });
```

Also test timeout, non-2xx redaction, missing key, mock mode, token cost math and no key/error body in logs.

- [ ] **Step 2: Run tests and verify RED**

```bash
npm test -- --run src/server/customer-service/config.test.ts src/server/customer-service/usage-cost.test.ts src/server/customer-service/providers/openai-responses.test.ts
```

Expected: FAIL because provider modules do not exist.

- [ ] **Step 3: Implement minimal provider and cost logic**

Use the Responses API with server-side key, configured low-cost model, `store: false`, bounded output tokens and `AbortSignal.timeout`. Return only text, model, usage and latency. Convert USD to rounded integer micro-USD.

Add only these empty/default server variables to `.env.example`:

```text
REPLY_ASSISTANT_ENABLED=false
REPLY_ASSISTANT_PILOT_LIMIT=100
AI_PROVIDER=mock
OPENAI_API_KEY=
OPENAI_MODEL=
AI_DAILY_WARNING_USD=
AI_DAILY_HARD_STOP_USD=
AI_TOTAL_WARNING_USD=
AI_TOTAL_HARD_STOP_USD=
META_APP_SECRET=
META_VERIFY_TOKEN=
META_PAGE_ID=
CUSTOMER_SERVICE_ID_HASH_SECRET=
```

Do not add `META_PAGE_ACCESS_TOKEN`.

- [ ] **Step 4: Run provider tests**

Run the Step 2 command.

Expected: all tests pass; source and test snapshots contain no key value.

- [ ] **Step 5: Commit**

```bash
git add src/server/customer-service/config.ts src/server/customer-service/config.test.ts src/server/customer-service/usage-cost.ts src/server/customer-service/usage-cost.test.ts src/server/customer-service/providers .env.example
git commit -m "feat: add server only reply provider"
```

### Task 7: Implement the Customer Service Engine

**Files:**
- Create: `src/server/customer-service/engine.ts`
- Create: `src/server/customer-service/engine.test.ts`
- Create: `src/server/customer-service/prompt-builder.ts`
- Create: `src/server/customer-service/prompt-builder.test.ts`
- Create: `src/server/customer-service/runtime.ts`

**Interfaces:**
- Consumes: internal message ID, repository, compiled knowledge and provider.
- Produces: `CustomerServiceEngine.generateDraft(request): Promise<DraftGenerationResult>`.

- [ ] **Step 1: Write failing engine tests with a provider spy**

Test allowed, HIGH RISK, unresolved, realtime, budget block, validator block, provider error and context isolation:

```ts
const provider = { generate: vi.fn() };
const result = await engine.generateDraft({ messageId: "message-1", trigger: "manual_generate" });
expect(result.status).toBe("gate_blocked");
expect(provider.generate).not.toHaveBeenCalled();
```

For an allowed message, assert one provider call, minimum relevant knowledge only, validator execution and persisted usage. For validator failure, assert no sendable draft text is persisted.

- [ ] **Step 2: Run tests and verify RED**

```bash
npm test -- --run src/server/customer-service/prompt-builder.test.ts src/server/customer-service/engine.test.ts
```

Expected: FAIL because engine modules do not exist.

- [ ] **Step 3: Implement straight-line orchestration**

Implement this order without a bypass option:

```ts
const input = await repository.loadDraftInput(request.messageId, 6);
const intent = detectIntent(input.current.body);
const gate = evaluatePolicyGate(input.current.body, intent, knowledge);
if (!gate.providerAllowed) return repository.createGateBlockedAttempt(/* safe facts */);
const sources = retrieveKnowledge(input, intent, knowledge);
const reservation = await repository.reserveProviderAttempt(/* worst-case cost */);
if (reservation.status === "budget_blocked") return reservationResult;
const response = await provider.generate(buildPrompt(input, intent, sources));
const validation = validateDraft(response.text, { intent });
await repository.completeProviderAttempt(/* approved draft or blocked hash */);
return validation.ok ? draftReady : outputBlocked;
```

Do not accept a caller-supplied gate decision, policy override, conversation ID or knowledge text.

- [ ] **Step 4: Run engine and policy regression tests**

```bash
npm test -- --run src/server/customer-service/engine.test.ts src/server/customer-service/policy-regression.test.ts
```

Expected: all pass; every blocked case has zero provider calls.

- [ ] **Step 5: Commit**

```bash
git add src/server/customer-service/engine.ts src/server/customer-service/engine.test.ts src/server/customer-service/prompt-builder.ts src/server/customer-service/prompt-builder.test.ts src/server/customer-service/runtime.ts
git commit -m "feat: orchestrate policy gated reply drafts"
```

### Task 8: Build the signed, DB-first Meta webhook

**Files:**
- Create: `src/server/customer-service/meta/signature.ts`
- Create: `src/server/customer-service/meta/signature.test.ts`
- Create: `src/server/customer-service/meta/webhook-handler.ts`
- Create: `src/server/customer-service/meta/webhook-handler.test.ts`
- Create: `src/app/api/meta/webhook/route-handler.ts`
- Create: `src/app/api/meta/webhook/route.test.ts`
- Create: `src/app/api/meta/webhook/route.ts`

**Interfaces:**
- Consumes: raw Meta request bytes and server-only Meta configuration.
- Produces: GET verification and POST ingestion that schedules `after()` only after a committed new message.

- [ ] **Step 1: Write failing signature tests**

Test valid HMAC, tampered body, malformed/missing header and timing-safe length mismatch. The implementation API is:

```ts
verifyMetaSignature({ rawBody, signatureHeader, appSecret }): boolean
```

- [ ] **Step 2: Write failing webhook route tests**

Inject `ingest`, `scheduleAfter` and `generateDraft`. Cover:

- GET correct and wrong verify token;
- invalid signature -> 401, zero persistence, zero scheduling;
- wrong Page -> 403, zero persistence;
- echo/unsupported -> 200, zero persistence;
- duplicate -> 200, zero scheduling;
- new valid event -> persistence resolves before scheduling and response;
- disabled flag -> 503, zero persistence and provider activity;
- background generation failure -> webhook still returns 200 after persistence.

Use an ordered event list:

```ts
expect(events).toEqual(["persist:start", "persist:commit", "after:schedule", "response:200"]);
```

- [ ] **Step 3: Run tests and verify RED**

```bash
npm test -- --run src/server/customer-service/meta/signature.test.ts src/server/customer-service/meta/webhook-handler.test.ts src/app/api/meta/webhook/route.test.ts
```

Expected: FAIL because webhook modules do not exist.

- [ ] **Step 4: Implement raw-body verification and ingestion**

Use Node `createHmac`, `timingSafeEqual` and the Facebook adapter. HMAC-hash external IDs before repository calls. `route.ts` must remain statically analyzable:

```ts
export const runtime = "nodejs";
export const maxDuration = 30;
export { GET, POST } from "./route-handler";
```

The production handler passes `after` from `next/server` as the scheduler. Never log raw body, signature, external ID or message text.

- [ ] **Step 5: Run webhook tests**

Run the Step 3 command.

Expected: all pass, including DB-before-schedule ordering and zero provider path for rejected events.

- [ ] **Step 6: Commit**

```bash
git add src/server/customer-service/meta src/app/api/meta/webhook
git commit -m "feat: ingest signed Messenger webhooks"
```

### Task 9: Add protected Reply Assistant APIs

**Files:**
- Create: `src/app/api/reply-assistant/messages/route.ts`
- Create: `src/app/api/reply-assistant/messages/route-handler.ts`
- Create: `src/app/api/reply-assistant/messages/route.test.ts`
- Create: `src/app/api/reply-assistant/messages/[messageId]/generate/route.ts`
- Create: `src/app/api/reply-assistant/messages/[messageId]/generate/route-handler.ts`
- Create: `src/app/api/reply-assistant/messages/[messageId]/generate/route.test.ts`
- Create: `src/app/api/reply-assistant/drafts/[attemptId]/regenerate/route.ts`
- Create: `src/app/api/reply-assistant/drafts/[attemptId]/regenerate/route-handler.ts`
- Create: `src/app/api/reply-assistant/drafts/[attemptId]/regenerate/route.test.ts`
- Create: `src/app/api/reply-assistant/drafts/[attemptId]/feedback/route.ts`
- Create: `src/app/api/reply-assistant/drafts/[attemptId]/feedback/route-handler.ts`
- Create: `src/app/api/reply-assistant/drafts/[attemptId]/feedback/route.test.ts`
- Create: `src/app/api/reply-assistant/metrics/route.ts`
- Create: `src/app/api/reply-assistant/metrics/route-handler.ts`
- Create: `src/app/api/reply-assistant/metrics/route.test.ts`

**Interfaces:**
- Consumes: internal message/attempt UUIDs, bounded feedback payloads and authenticated Better Auth access.
- Produces: no-store queue, generation, regeneration, feedback and metric JSON APIs. No send API.

- [ ] **Step 1: Write failing route authorization tests**

For every handler, assert `requirePermission("use_reply_assistant")`. For POST handlers, assert trusted origin and bounded JSON. Test 401/403, wrong origin, invalid UUID, oversized body and feature disabled.

```ts
expect(requirePermission).toHaveBeenCalledWith("use_reply_assistant");
expect(response.headers.get("Cache-Control")).toBe("no-store");
```

- [ ] **Step 2: Write cross-customer isolation DTO tests**

Return a repository fixture containing internal hashes and assert the route DTO omits:

```ts
expect(JSON.stringify(body)).not.toMatch(/external|sender|psid|access.?token|conversationKey/i);
```

Attempt regeneration must derive `messageId` from `attemptId` in the repository; reject a request body containing a conversation or message override.

- [ ] **Step 3: Run route tests and verify RED**

```bash
npm test -- --run src/app/api/reply-assistant
```

Expected: FAIL because the routes do not exist.

- [ ] **Step 4: Implement thin handler factories**

Follow existing admin route conventions: `runtime = "nodejs"`, injected dependencies, `requireAdminPermission`, `assertTrustedMutationRequest`, `parseBoundedJson`, safe errors and no-store responses. Accept feedback actions only from the database design enum.

- [ ] **Step 5: Prove no send route exists**

Add a source-structure test that fails if any Reply Assistant API file or exported service function matches `sendMessenger`, `sendToMeta`, `Graph API`, `/send` or `META_PAGE_ACCESS_TOKEN`.

- [ ] **Step 6: Run API tests**

```bash
npm test -- --run src/app/api/reply-assistant src/server/customer-service/no-auto-send.test.ts
```

Expected: all tests pass and the no-send scan finds zero matches.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/reply-assistant src/server/customer-service/no-auto-send.test.ts
git commit -m "feat: expose reviewed reply draft APIs"
```

### Task 10: Build the human-review UI and dashboard

**Files:**
- Create: `src/app/reply-assistant/page.tsx`
- Create: `src/app/reply-assistant/loading.tsx`
- Create: `src/components/reply-assistant/reply-assistant-client.tsx`
- Create: `src/components/reply-assistant/reply-assistant-client.test.tsx`
- Create: `src/components/reply-assistant/reply-assistant.module.css`
- Create: `src/server/customer-service/metrics.ts`
- Create: `src/server/customer-service/metrics.test.ts`
- Modify: `src/components/admin/admin-shell.tsx`
- Modify: `src/components/admin/admin-shell.test.tsx`

**Interfaces:**
- Consumes: the protected APIs from Task 9.
- Produces: authenticated queue, draft review controls, manual-copy workflow and pilot metrics.

- [ ] **Step 1: Write failing metric tests**

Define denominators explicitly:

```ts
expect(metrics.directAcceptanceRate).toBe(acceptedUnchanged / draftsGenerated);
expect(metrics.assistedAcceptanceRate).toBe((acceptedUnchanged + editedAccepted) / draftsGenerated);
expect(metrics.editedThenManuallySent).toBe(editedSentConfirmed);
expect(metrics.policyViolationRate).toBe(policyViolationAttempts / providerCalls);
expect(metrics.averageCostPerDraftMicrousd).toBe(totalGeneratedCost / draftsGenerated);
```

Zero denominators return zero. An output-validator block is counted separately and contributes to `policyViolationAttempts` only when its validator code is classified as a policy violation. Regenerations affect provider call/cost totals but not incoming eligible count.

- [ ] **Step 2: Write failing UI workflow tests**

Cover Generate, Regenerate, Edit, Accept unchanged, Reject, Copy and explicit **Mark as manually sent**. Assert Copy is disabled until a human accepts or edits the draft. Assert Copy calls `navigator.clipboard.writeText` and the feedback API but no Messenger endpoint.

```tsx
expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
fireEvent.click(screen.getByRole("button", { name: "Accept unchanged" }));
expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled();
expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringMatching(/send|graph\.facebook/i), expect.anything());
```

Blocked cards display risk/reason and no draft textarea. Provider errors expose Retry/Generate only, never raw provider errors.

- [ ] **Step 3: Run tests and verify RED**

```bash
npm test -- --run src/server/customer-service/metrics.test.ts src/components/reply-assistant/reply-assistant-client.test.tsx src/components/admin/admin-shell.test.tsx
```

Expected: FAIL because UI and metric modules do not exist.

- [ ] **Step 4: Implement the minimal UI**

Reuse existing AdminShell, typography, buttons and spacing. Use compact message cards with stable control dimensions. Do not add marketing copy, decorative sections or nested cards. Label the workflow accurately: Copy does not mean sent; **Mark as manually sent** is a separate human confirmation and never calls Meta.

- [ ] **Step 5: Run UI tests and accessibility checks**

Run the Step 3 command. Then run the page with mock provider and verify keyboard focus, disabled states, mobile width, no text overlap and no horizontal overflow.

Expected: tests pass; the page is usable at 390 px and desktop widths.

- [ ] **Step 6: Commit**

```bash
git add src/app/reply-assistant/page.tsx src/app/reply-assistant/loading.tsx src/components/reply-assistant src/server/customer-service/metrics.ts src/server/customer-service/metrics.test.ts src/components/admin/admin-shell.tsx src/components/admin/admin-shell.test.tsx
git commit -m "feat: add human reviewed reply assistant UI"
```

### Task 11: Complete security, serverless and regression verification

**Files:**
- Create: `src/server/customer-service/security-regression.test.ts`
- Create: `src/server/customer-service/serverless-compatibility.test.ts`
- Modify: `docs/releases/2026-08-17-reply-assistant-staging-validation.md`
- Modify: `docs/releases/2026-08-17-reply-assistant-production-rollout.md`

**Interfaces:**
- Consumes: the complete candidate.
- Produces: executable safety evidence and filled validation records; no deployment.

- [ ] **Step 1: Add the final security tests**

Tests must prove:

- HIGH RISK, unresolved and realtime inputs call the provider zero times;
- wrong Page, invalid signature, echo and duplicate schedule zero attempts;
- no cross-customer context;
- unauthenticated/customer roles cannot access UI or API;
- no auto-send symbols, `/send` route or `META_PAGE_ACCESS_TOKEN` exist;
- no runtime module imports `fs`, `node:fs`, standalone JSONL ledgers, localhost or ngrok;
- the client bundle entry graph does not import server configuration;
- all 100 evaluation cases retain expected gate decisions.

- [ ] **Step 2: Run focused safety tests**

```bash
npm test -- --run src/server/customer-service src/app/api/meta/webhook src/app/api/reply-assistant src/components/reply-assistant
```

Expected: all focused tests pass with zero bypass.

- [ ] **Step 3: Run static checks**

```bash
npm run knowledge:check
npm run typecheck
npm run lint -- --quiet
npm run db:check
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 4: Run the complete suite with an isolated database**

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm run test:run
```

Expected: every unit and integration suite passes; no suite uses Staging or Production data.

- [ ] **Step 5: Run Production build and secret scan**

```bash
REPLY_ASSISTANT_ENABLED=false npm run build
if rg -n --hidden --glob '!**/*.test.*' \
  '(sk-[A-Za-z0-9_-]{20,}|META_PAGE_ACCESS_TOKEN|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|ngrok-free\.app)' \
  src scripts .env.example .next; then
  echo "Forbidden secret or send capability found"
  exit 1
else
  status=$?
  test "$status" -eq 1
fi
```

Expected: build exits 0. The scan finds no credential value, no page access token variable and no active ngrok URL in application/build output; approved rollout documentation may mention the word `ngrok` without containing a callback URL.

- [ ] **Step 6: Execute the Staging checklist without changing Production**

Follow `docs/releases/2026-08-17-reply-assistant-staging-validation.md`. Record exact deployment ID, test database, signed fixture results, auth matrix, 100-case result, model cost/latency and browser evidence. Leave Production feature flag and Meta callback unchanged.

- [ ] **Step 7: Review the rollout checklist, but do not execute it**

Confirm every prerequisite and rollback instruction in `docs/releases/2026-08-17-reply-assistant-production-rollout.md` is actionable. Unchecked Production items remain unchecked pending explicit approval.

- [ ] **Step 8: Commit**

```bash
git add src/server/customer-service/security-regression.test.ts src/server/customer-service/serverless-compatibility.test.ts docs/releases/2026-08-17-reply-assistant-staging-validation.md docs/releases/2026-08-17-reply-assistant-production-rollout.md
git commit -m "test: verify reply assistant pilot safety"
```

## Final review gate

Before requesting implementation approval:

1. Map every design acceptance criterion to a named test or staging checklist item.
2. Scan for unfinished or generic implementation instructions and replace each one with an exact action.
3. Confirm types and status names match the design and database documents.
4. Confirm the file list contains no Messenger send route or page access token.
5. Confirm the callback change appears only in the Production rollout checklist and is the final activation step.
